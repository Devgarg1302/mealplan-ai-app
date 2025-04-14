import { NextRequest, NextResponse } from "next/server";
import { razorpay } from "@/lib/razorpay";
import prisma from "@/lib/prisma";

// Define a type for Razorpay subscription
type RazorpaySubscription = {
  id: string;
  plan_id: string;
  status: string;
  short_url?: string;
  total_count: number;
  notes?: {
    userId?: string | number | null;
    planType?: string | number | null;
    email?: string | number | null;
  };
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

    // Fetch the subscription from our database
    const subscriptionRecord = await prisma.subscription.findFirst({
      where: { 
        razorpaySubscriptionId: subscriptionId,
        userId: String(userId),
      },
    });

    if (!subscriptionRecord) {
      return NextResponse.json(
        { error: "Subscription not found in our records" },
        { status: 404 }
      );
    }

    // Fetch the subscription from Razorpay
    const subscription = await razorpay.subscriptions.fetch(subscriptionId) as RazorpaySubscription;
    
    // Check if the subscription exists in Razorpay
    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found in Razorpay" },
        { status: 404 }
      );
    }
    
    // Check if subscription belongs to this user (from notes)
    if (subscription.notes?.userId !== userId) {
      return NextResponse.json(
        { error: "Subscription does not belong to this user" },
        { status: 403 }
      );
    }
    
    // Handle different subscription statuses
    if (subscription.status === 'active') {
      // Update our records if the subscription is already active in Razorpay
      await prisma.subscription.update({
        where: { id: subscriptionRecord.id },
        data: { status: 'active' },
      });
      
      await prisma.profile.update({
        where: { userId: String(userId) },
        data: {
          subscriptionActive: true,
          subscriptionTier: subscriptionRecord.planType,
        },
      });
      
      return NextResponse.json({
        message: "Subscription is already active",
        url: "/mealplan" 
      });
    }
    
    // If the subscription is cancelled, create a new one
    if (subscription.status === 'cancelled' || subscription.status === 'expired') {
      // Get the plan details from the original subscription
      const planId = subscription.plan_id;
      const planType = subscription.notes?.planType || "month"; // Default to month
      const email = subscription.notes?.email || ""; // Default to empty string
      
      // Create a new subscription with the same plan
      const newSubscription = await razorpay.subscriptions.create({
        plan_id: planId,
        total_count: subscription.total_count,
        customer_notify: 1,
        notes: {
          userId,
          planType,
          email
        },
      }) as RazorpaySubscription;
      
      // Update the database with the new subscription
      await prisma.subscription.create({
        data: {
          userId: String(userId),
          planId,
          razorpaySubscriptionId: newSubscription.id,
          status: newSubscription.status,
          planType: String(planType), // Convert to string
          isRecurring: newSubscription.total_count > 1 || newSubscription.total_count === 0,
        },
      });
      
      // Generate a callback URL to return to our app
      const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const callbackUrl = `${origin}/subscribe?sessionId=${newSubscription.id}`;
      console.log(`Generated callback URL for new subscription: ${callbackUrl}`);
      
      return NextResponse.json({
        url: newSubscription.short_url || "",
        callbackUrl: callbackUrl,
        message: "New subscription created successfully",
        subscriptionId: newSubscription.id,
      });
    }
    
    // For created, authenticated, or pending subscriptions
    if (['created', 'authenticated', 'pending'].includes(subscription.status)) {
      // Generate a callback URL to return to our app
      const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const callbackUrl = `${origin}/subscribe?sessionId=${subscription.id}`;
      console.log(`Generated callback URL: ${callbackUrl}`);
      
      // Return the payment URL
      return NextResponse.json({
        url: subscription.short_url || "",
        callbackUrl: callbackUrl,
        message: "Payment URL generated successfully"
      });
    }
    
    // For any other status, provide information to the user
    return NextResponse.json({
      message: `Subscription status is: ${subscription.status}. Cannot resume payment at this time.`,
      status: subscription.status,
    }, { status: 400 });
  } catch (error: any) {
    console.error("Error resuming payment:", error);
    return NextResponse.json(
      { error: error.message || "Failed to resume payment" },
      { status: 500 }
    );
  }
} 