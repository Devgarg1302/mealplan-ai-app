import { getPriceIdFromType } from "@/lib/plans";
import { NextRequest, NextResponse } from "next/server";
import { razorpay } from "@/lib/razorpay";
import { availablePlans } from "@/lib/plans";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
    try {
        const { planType, userId, email } = await request.json();

        if (!planType || !userId || !email) {
            return NextResponse.json({ error: "Plan Type, userId and email are required" }, { status: 400 });
        }

        const allowedPlans = ["week", "month", "year"];
        if (!allowedPlans.includes(planType)) {
            return NextResponse.json({ error: "Invalid plan type" }, { status: 400 });
        }

        const priceId = getPriceIdFromType(planType);
        if (!priceId) {
            return NextResponse.json({ error: "Invalid price id" }, { status: 400 });
        }

        // Check if user already has an active subscription
        const activeSubscription = await prisma.subscription.findFirst({
            where: {
                userId,
                status: "active",
                endDate: {
                    gte: new Date(),
                }
            }
        });

        if (activeSubscription) {
            return NextResponse.json({
                error: "You already have an active subscription. You cannot subscribe to a different plan. Please wait until your current subscription expires.",
                currentPlan: activeSubscription.planType,
                endDate: activeSubscription.endDate
            }, { status: 400 });
        }

        // Create Razorpay subscription
        const subscription = await razorpay.subscriptions.create({
            plan_id: priceId,
            total_count: 1,
            customer_notify: 1,
            notes: {
                userId,
                planType,
                email
            },
        });

        // Generate a callback URL that includes the subscription ID
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const callbackUrl = `${origin}/subscribe?sessionId=${subscription.id}`;
        console.log(`Generated callback URL: ${callbackUrl}`);

        await prisma.subscription.create({
            data: {
                userId,
                planId: subscription.plan_id,
                razorpaySubscriptionId: subscription.id,
                status: subscription.status,
                planType,
                isRecurring: false,
            }
        });

        return NextResponse.json({
            subscriptionId: subscription.id,
            planId: subscription.plan_id,
            status: subscription.status,
            url: subscription.short_url,
            callbackUrl: callbackUrl,
        });
    } catch (error) {
        console.error("Error creating Razorpay subscription:", error);
        return NextResponse.json(
            { error: "Failed to create subscription session" },
            { status: 500 }
        );
    }
}