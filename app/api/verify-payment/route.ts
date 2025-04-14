import { NextRequest, NextResponse } from "next/server";
import { razorpay } from "@/lib/razorpay";
import prisma from "@/lib/prisma";
import crypto from "crypto";

// Helper function to calculate end date based on plan type
function calculateEndDate(planType: string | number | null | undefined): Date {
  const now = new Date();
  const endDate = new Date(now);

  // Convert planType to string to handle cases when it's a number
  const planTypeStr = planType?.toString() || "month";

  switch (planTypeStr) {
    case "week":
      endDate.setDate(now.getDate() + 7);
      break;
    case "month":
      endDate.setMonth(now.getMonth() + 1);
      break;
    case "year":
      endDate.setFullYear(now.getFullYear() + 1);
      break;
    default:
      endDate.setMonth(now.getMonth() + 1); // Default to 1 month
  }

  return endDate;
}

export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json();

    console.log("Received request data:", requestData);

    // Handle two types of verification: direct from webhook with signatures or session_id from redirect
    if (requestData.sessionId || requestData.subscriptionId) {
      // Handle verification after redirect from short URL (session_id or subscriptionId)
      const sessionId = requestData.sessionId || requestData.subscriptionId;

      // Fetch the subscription from Razorpay
      const subscription = await razorpay.subscriptions.fetch(sessionId);

      const dbsubscritpion = await prisma.subscription.findFirst({
        where: {
          razorpaySubscriptionId: sessionId,
        },
      });
      // Check if the subscription exists
      if (!subscription) {
        return NextResponse.json(
          { success: false, error: "Subscription not found" },
          { status: 404 }
        );
      }

      // Extract user ID from notes
      const userId = subscription.notes?.userId;
      const planType = String(subscription.notes?.planType || "month");

      if (!userId) {
        return NextResponse.json(
          { success: false, error: "User ID not found in subscription" },
          { status: 400 }
        );
      }

      // Check subscription status
      if (subscription.status === 'created' || subscription.status === 'authenticated') {
        return NextResponse.json({
          success: false,
          pending: true,
          message: "Subscription payment is pending",
          pendingSubscriptionId: subscription.id,
        });
      }

      // If status is "cancelled" it means the payment wasn't completed
      if (subscription.status === 'cancelled') {
        return NextResponse.json({
          success: false,
          message: "Payment was not completed",
          pendingSubscriptionId: subscription.id,
        });
      }

      // If the subscription is active, update the database
      if ((subscription.status === 'active' || subscription.status === 'completed') && dbsubscritpion?.status !== "cancelled") {
        // Update subscription records in our database
        await prisma.subscription.upsert({
          where: {
            razorpaySubscriptionId: sessionId
          },
          update: {
            status: "active",
            startDate: new Date(),
            endDate: calculateEndDate(planType),
          },
          create: {
            userId: String(userId),
            planId: subscription.plan_id,
            razorpaySubscriptionId: subscription.id,
            status: "active",
            planType,
            startDate: new Date(),
            endDate: calculateEndDate(planType),
            isRecurring: false, // Always non-recurring
          },
        });

        // Update user profile
        await prisma.profile.update({
          where: { userId: String(userId) },
          data: {
            subscriptionActive: true,
            subscriptionTier: String(planType || "month"), // Convert to string
            stripeSubscriptionId: subscription.id, // Using the same field for consistency
          },
        });

        return NextResponse.json({
          success: true,
          message: "Subscription verified and activated",
        });
      }

      // Subscription exists but is not active
      return NextResponse.json({
        success: false,
        message: `Subscription status: ${subscription.status}`,
        status: subscription.status,
      });
    } else {
      // Original webhook verification flow
      const {
        razorpay_payment_id,
        razorpay_subscription_id,
        razorpay_signature,
        userId,
      } = requestData;

      // Verify the payment signature
      const generatedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
        .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
        .digest("hex");

      // Check if the generated signature matches the one received from Razorpay
      if (generatedSignature !== razorpay_signature) {
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 400 }
        );
      }

      // Get subscription details from Razorpay
      const subscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);
      const planType = String(subscription.notes?.planType || "month");

      // Update subscription in database
      await prisma.subscription.upsert({
        where: {
          razorpaySubscriptionId: razorpay_subscription_id
        },
        update: {
          status: "active",
          razorpayPaymentId: razorpay_payment_id,
          startDate: new Date(),
          endDate: calculateEndDate(planType),
        },
        create: {
          userId: String(userId),
          planId: subscription.plan_id,
          razorpaySubscriptionId: subscription.id,
          razorpayPaymentId: razorpay_payment_id,
          status: "active",
          planType,
          startDate: new Date(),
          endDate: calculateEndDate(planType),
          isRecurring: false, // Always non-recurring
        },
      });

      // Update user profile
      await prisma.profile.update({
        where: { userId: String(userId) },
        data: {
          subscriptionActive: true,
          subscriptionTier: String(planType || "month"), // Convert to string
          stripeSubscriptionId: razorpay_subscription_id, // Using the same field for consistency
        },
      });

      return NextResponse.json({
        success: true,
        message: "Payment verified and subscription activated",
      });
    }
  } catch (error: any) {
    console.error("Error verifying payment:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to verify payment" },
      { status: 500 }
    );
  }
} 