import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@clerk/nextjs/server";
import { razorpay } from "@/lib/razorpay";

// Define the plan interface
interface RazorpayPlan {
  id: string;
  entity: string;
  interval: number;
  period: string;
  item: {
    id: string;
    name: string;
    amount: number;
    currency: string;
  };
}

export async function GET() {
  try {
    const clerkUser = await currentUser();
    if (!clerkUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch user profile via Prisma with subscription data
    const profile = await prisma.profile.findUnique({
      where: { userId: clerkUser.id },
      include: {
        subscriptions: {
          where: {
            OR: [
              { status: "active" },
              { status: "created" },
              { 
                status: "cancelled",
                endDate: { gte: new Date() }
              }
            ]
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      }
    });

    // If no profile found, return null
    if (!profile) {
      return NextResponse.json({ subscription: null });
    }

    // Get the current subscription
    const currentSubscription = profile.subscriptions?.[0] || null;
    
    // If there's a current subscription, fetch its plan details from Razorpay
    let planDetails = null;
    if (currentSubscription && currentSubscription.planId) {
      try {
        const plan = await razorpay.plans.fetch(currentSubscription.planId) as unknown as RazorpayPlan;
        planDetails = {
          id: plan.id,
          interval: plan.period,
          amount: plan.item.amount / 100, // Convert from smallest currency unit
          currency: plan.item.currency,
          name: plan.item.name
        };
        console.log("Fetched plan details from Razorpay:", planDetails);
      } catch (error) {
        console.error("Error fetching plan details from Razorpay:", error);
      }
    }

    return NextResponse.json({ 
      subscription: {
        ...profile,
        currentSubscription,
        planDetails
      } 
    });
  } catch (error: any) {
    console.error("Error fetching subscription:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription details." },
      { status: 500 }
    );
  }
}