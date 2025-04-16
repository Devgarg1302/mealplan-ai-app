import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// Type definitions for Razorpay webhook payloads
interface RazorpayEntity {
  id: string;
  plan_id: string;
  notes?: {
    userId?: string;
    planType?: string;
    email?: string;
  };
  subscription_id?: string;
}

interface RazorpayWebhookPayload {
  entity: RazorpayEntity;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-razorpay-signature") || "";

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET || "")
      .update(body)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.error("Invalid webhook signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    const webhookData = JSON.parse(body);
    const event = webhookData.event;
    const payload = webhookData.payload.subscription || webhookData.payload.payment;

    console.log(`Processing webhook event: ${event}`);

    // Handle different webhook events
    switch (event) {
      case "subscription.activated":
        await handleSubscriptionActivated(payload);
        break;

      case "subscription.pending":
        await handleSubscriptionPending(payload);
        break;

      case "subscription.halted":
        await handleSubscriptionHalted(payload);
        break;

      case "subscription.cancelled":
        await handleSubscriptionCancelled(payload);
        break;

      case "payment.captured":
        await handlePaymentCaptured(payload);
        break;

      case "payment.failed":
        await handlePaymentFailed(payload);
        break;

      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Error processing webhook:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process webhook";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

async function handleSubscriptionActivated(payload: RazorpayWebhookPayload) {
  const subscriptionId = payload.entity.id;
  const notes = payload.entity.notes || {};
  const userId = notes.userId;
  const planType = notes.planType;
  const planId = payload.entity.plan_id;

  if (!userId || !planType || !planId) {
    console.error("Missing required fields in subscription payload");
    return;
  }

  try {
    // Update subscription status
    await prisma.subscription.upsert({
      where: { razorpaySubscriptionId: subscriptionId },
      update: {
        status: "active",
        startDate: new Date(),
        // Calculate end date based on plan type
        endDate: calculateEndDate(planType),
      },
      create: {
        userId,
        planId,
        razorpaySubscriptionId: subscriptionId,
        status: "active",
        planType,
        startDate: new Date(),
        endDate: calculateEndDate(planType),
        isRecurring: false, // Always non-recurring
      },
    });

    // Update user profile
    await prisma.profile.update({
      where: { userId },
      data: {
        subscriptionActive: true,
        subscriptionTier: planType,
        stripeSubscriptionId: subscriptionId, // Using same field for consistency
      },
    });

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/subscribe`);

  } catch (error) {
    console.error("Error handling activated subscription:", error);
  }
}

async function handleSubscriptionPending(payload: RazorpayWebhookPayload) {
  const subscriptionId = payload.entity.id;
  const notes = payload.entity.notes || {};
  const userId = notes.userId;
  const planType = notes.planType;
  const planId = payload.entity.plan_id;

  if (!userId || !planType || !planId) {
    console.error("Missing required fields in subscription payload");
    return;
  }

  try {
    await prisma.subscription.upsert({
      where: { razorpaySubscriptionId: subscriptionId },
      update: {
        status: "pending",
      },
      create: {
        userId,
        planId,
        razorpaySubscriptionId: subscriptionId,
        status: "pending",
        planType,
        isRecurring: false, // Always non-recurring
      },
    });

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/subscribe`);

  } catch (error) {
    console.error("Error handling pending subscription:", error);
  }
}

async function handleSubscriptionHalted(payload: RazorpayWebhookPayload) {
  const subscriptionId = payload.entity.id;

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subscriptionId },
      select: { userId: true },
    });

    if (!subscription) return;

    await prisma.subscription.update({
      where: { razorpaySubscriptionId: subscriptionId },
      data: { status: "halted" },
    });

    await prisma.profile.update({
      where: { userId: subscription.userId },
      data: { subscriptionActive: false },
    });

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/subscribe`);

  } catch (error) {
    console.error("Error handling halted subscription:", error);
  }
}

async function handleSubscriptionCancelled(payload: RazorpayWebhookPayload) {
  const subscriptionId = payload.entity.id;

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subscriptionId },
      select: { userId: true },
    });

    if (!subscription) return;

    await prisma.subscription.update({
      where: { razorpaySubscriptionId: subscriptionId },
      data: { status: "cancelled" },
    });

    await prisma.profile.update({
      where: { userId: subscription.userId },
      data: { subscriptionActive: false },
    });
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/subscribe`);

  } catch (error) {
    console.error("Error handling cancelled subscription:", error);
  }
}

async function handlePaymentCaptured(payload: RazorpayWebhookPayload) {
  const paymentId = payload.entity.id;
  const subscriptionId = payload.entity.subscription_id;

  if (!subscriptionId) {
    console.log("Payment not associated with subscription");
    return;
  }

  try {
    // Update the subscription with payment information
    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId: subscriptionId },
      data: {
        razorpayPaymentId: paymentId,
        status: "active", // Mark as active when payment is captured
      },
    });

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/subscribe`);

  } catch (error) {
    console.error("Error handling payment captured:", error);
  }
}

async function handlePaymentFailed(payload: RazorpayWebhookPayload) {
  const subscriptionId = payload.entity.subscription_id;

  if (!subscriptionId) return;

  try {
    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId: subscriptionId },
      data: { status: "halted" },
    });

    // Get the subscription to find the user
    const subscription = await prisma.subscription.findFirst({
      where: { razorpaySubscriptionId: subscriptionId },
    });

    if (subscription) {
      // Update the user profile to reflect inactive subscription
      await prisma.profile.update({
        where: { userId: subscription.userId },
        data: { subscriptionActive: false },
      });
    }
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/subscribe`);


  } catch (error) {
    console.error("Error handling payment failure:", error);
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