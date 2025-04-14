import { NextRequest, NextResponse } from "next/server";
import { razorpay } from "@/lib/razorpay";
import prisma from "@/lib/prisma";

// Define a type for Razorpay subscription
type RazorpaySubscription = {
  id: string;
  status: string;
};

export async function POST(request: NextRequest) {
  try {
    const { subscriptionId, userId } = await request.json();

    if (!subscriptionId || !userId) {
      return NextResponse.json(
        { error: "Subscription ID and user ID are required" },
        { status: 400 }
      );
    }

    // Check if the subscription belongs to the user
    const subscription = await prisma.subscription.findFirst({
      where: {
        razorpaySubscriptionId: subscriptionId,
        userId: String(userId),
      },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found or does not belong to this user" },
        { status: 404 }
      );
    }

    // Only active subscriptions can be cancelled in our system
    // if (subscription.status !== "active") {
    //   return NextResponse.json(
    //     { error: `Cannot cancel subscription with status: ${subscription.status}` },
    //     { status: 400 }
    //   );
    // }

    // Check Razorpay subscription status first
    try {
      const razorpaySubscription = await razorpay.subscriptions.fetch(subscriptionId) as unknown as RazorpaySubscription;

      // Cannot cancel completed subscriptions in Razorpay
      if (razorpaySubscription.status === "completed") {
        console.log("Subscription is already completed in Razorpay, marking as cancelled in our database");

        // Just mark as cancelled in our database
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "cancelled",
          },
        });

        await prisma.profile.update({
          where: { userId: String(userId) },
          data: {
            subscriptionActive: false,
            stripeSubscriptionId: null,
            subscriptionTier: null,
          },
        });

        return NextResponse.json({
          success: true,
          message: "Subscription is completed. Your access will remain until the end date.",
        });
      }
    } catch (error) {
      console.error("Error fetching Razorpay subscription:", error);
      // Continue with cancellation attempt if we can't fetch the status
    }

    // Cancel the subscription in Razorpay
    try {
      // Razorpay's cancel method doesn't accept options for cancel_at_cycle_end
      const result = await razorpay.subscriptions.cancel(subscriptionId) as unknown as RazorpaySubscription;

      console.log("Razorpay cancellation result:", result);

      // Update our database
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "cancelled",
        },
      });

      // Update user profile
      await prisma.profile.update({
        where: { userId: String(userId) },
        data: {
          subscriptionActive: false,
          stripeSubscriptionId: null,
          subscriptionTier: null,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Subscription cancelled successfully",
      });
    } catch (error: any) {
      console.error("Razorpay cancellation error:", error);

      // Handle Razorpay cancellation error
      if (error.message?.includes("completed") || error.message?.includes("already been processed")) {
        console.log("Razorpay error indicates completed subscription");

        // Just mark as cancelled in our database
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "cancelled",
          },
        });

        return NextResponse.json({
          success: true,
          message: "Subscription is completed. Your access will remain until the end date.",
        });
      }

      // Re-throw for other errors
      throw error;
    }
  } catch (error: any) {
    console.error("Error cancelling subscription:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to cancel subscription" },
      { status: 500 }
    );
  }
} 