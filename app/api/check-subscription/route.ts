import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { razorpay } from "@/lib/razorpay";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    // Check for active subscriptions in our database
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: ["active", "completed"],
        },
        endDate: {
          gte: new Date(), // End date is in the future
        }
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log("Active Subscription:", activeSubscription);

    if (activeSubscription) {
      return NextResponse.json({
        isActive: true,
        isPending: false,
        subscriptionTier: activeSubscription.planType,
        subscriptionId: activeSubscription.razorpaySubscriptionId,
        endDate: activeSubscription.endDate,
        isRecurring: false,
      });
    }

    // Check for pending or created subscriptions
    const pendingSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: ["created", "authenticated", "pending"],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (pendingSubscription) {
      try {
        // Verify with Razorpay that this subscription is still pending
        const razorpaySubscription = await razorpay.subscriptions.fetch(
          pendingSubscription.razorpaySubscriptionId || ""
        );

        if (razorpaySubscription.status === 'active' || razorpaySubscription.status === 'completed') {
          // If active in Razorpay but not in our DB, update our DB
          await prisma.subscription.update({
            where: { id: pendingSubscription.id },
            data: { 
              status: "active",
              startDate: new Date(),
              // Calculate end date based on plan type
              endDate: calculateEndDate(pendingSubscription.planType),
            },
          });

          // Update profile
          await prisma.profile.update({
            where: { userId },
            data: {
              subscriptionActive: true,
              subscriptionTier: pendingSubscription.planType,
            },
          });

          return NextResponse.json({
            isActive: true,
            isPending: false,
            subscriptionTier: pendingSubscription.planType,
            subscriptionId: pendingSubscription.razorpaySubscriptionId,
            isRecurring: pendingSubscription.isRecurring,
          });
        }

        if (['created', 'authenticated', 'pending'].includes(razorpaySubscription.status)) {
          return NextResponse.json({
            isActive: false,
            isPending: true,
            pendingSubscriptionId: pendingSubscription.razorpaySubscriptionId,
            pendingPlanType: pendingSubscription.planType,
          });
        } else {
          // Subscription is in another state (cancelled, expired, etc.)
          await prisma.subscription.update({
            where: { id: pendingSubscription.id },
            data: { status: razorpaySubscription.status },
          });
        }
      } catch (error) {
        console.error("Error checking Razorpay subscription:", error);
        // Continue to check other potential subscriptions
      }
    }

    // No active or pending subscription found
    return NextResponse.json({
      isActive: false,
      isPending: false,
    });
  } catch (error: any) {
    console.error("Error checking subscription:", error);
    return NextResponse.json(
      { error: error.message || "Failed to check subscription status" },
      { status: 500 }
    );
  }
}

function calculateEndDate(planType: string): Date {
  const now = new Date();
  const endDate = new Date(now);
  
  switch (planType) {
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
