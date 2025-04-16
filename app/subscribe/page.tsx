"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { availablePlans } from "@/lib/plans";
import { useState, useEffect } from "react";
import toast, { Toaster } from "react-hot-toast";

type SubscribeResponse = {
  url: string;
  callbackUrl?: string;
  subscriptionId?: string;
  planId?: string;
  status?: string;
};

type SubscribeError = {
  error: string;
};

type SubscriptionStatus = {
  isActive: boolean;
  isPending: boolean;
  pendingSubscriptionId?: string;
  subscriptionTier?: string;
  subscriptionId?: string;
  endDate?: string | Date;
  isRecurring?: boolean;
};

// Define additional types
type CancelResponse = {
  success: boolean;
  message: string;
};

// Define resumePayment response type
type ResumePaymentResponse = {
  url: string;
  message: string;
  subscriptionId?: string;
};

// API call function to subscribe to a plan
const subscribeToPlan = async ({
  planType,
  userId,
  email,
}: {
  planType: string;
  userId: string;
  email: string;
}): Promise<SubscribeResponse> => {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planType,
      userId,
      email,
    }),
  });

  if (!res.ok) {
    const errorData: SubscribeError = await res.json();
    throw new Error(errorData.error || "Something went wrong.");
  }

  const data: SubscribeResponse = await res.json();
  return data;
};

// API call function to verify a payment
const verifyPayment = async (sessionId: string): Promise<{ success: boolean }> => {
  const res = await fetch("/api/verify-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      subscriptionId: sessionId // Send as both parameters to be safe
    }),
  });

  if (!res.ok) {
    const errorData: SubscribeError = await res.json();
    throw new Error(errorData.error || "Payment verification failed.");
  }

  return await res.json();
};

// API call to check subscription status
const checkSubscriptionStatus = async (userId: string): Promise<SubscriptionStatus> => {
  if (!userId) return { isActive: false, isPending: false };

  const res = await fetch(`/api/check-subscription?userId=${userId}`);
  if (!res.ok) {
    throw new Error("Failed to check subscription status");
  }
  return await res.json();
};

// API call function to cancel a subscription
const cancelSubscription = async (subscriptionId: string, userId: string): Promise<CancelResponse> => {
  const res = await fetch("/api/cancel-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscriptionId,
      userId,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || "Failed to cancel subscription.");
  }

  return await res.json();
};

// API call function to resume a pending payment
const resumePayment = async (
  subscriptionId: string,
  userId: string
): Promise<ResumePaymentResponse> => {
  const res = await fetch("/api/resume-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscriptionId, userId }),
  });

  if (!res.ok) {
    const errorData: SubscribeError = await res.json();
    throw new Error(errorData.error || "Failed to resume payment.");
  }

  return await res.json();
};

export default function SubscribePage() {
  const { user } = useUser();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(false);

  const userId = user?.id;
  const email = user?.emailAddresses?.[0]?.emailAddress || "";


  // Query to check user's subscription status
  const { data: subscriptionStatus, isLoading: isLoadingStatus } = useQuery({
    queryKey: ['subscriptionStatus', userId],
    queryFn: () => checkSubscriptionStatus(userId || ''),
    enabled: !!userId,
  });

  // Verify payment on return from checkout
  const verificationMutation = useMutation({
    mutationFn: verifyPayment,
    onMutate: () => {
      setIsVerifying(true);
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Payment successful! Your subscription is now active.");
        setIsVerifying(false);
      } else {
        toast.error("Payment verification failed. Please contact support.");
        setIsVerifying(false);
      }
    },
    onError: (error) => {
      toast.error(error.message || "Payment verification failed");
      setIsVerifying(false);
    }
  });

  // Check for session_id in URL when component mounts
  useEffect(() => {
    // Check if we have any payment/subscription ID in the URL
    const verificationId = subscriptionStatus?.subscriptionId || subscriptionStatus?.pendingSubscriptionId;
    console.log("Verifying payment with ID:", verificationId);


    if (verificationId) {
      verificationMutation.mutate(verificationId);
    } else {
      console.log("Payment verification failed");
    }
  }, [subscriptionStatus?.subscriptionId || subscriptionStatus?.pendingSubscriptionId]);

  //main mutation
  const mutation = useMutation<SubscribeResponse, Error, { planType: string }>({
    mutationFn: async ({ planType }) => {
      if (!userId) {
        throw new Error("User not signed in.");
      }

      return subscribeToPlan({ planType, userId, email });
    },
    onMutate: () => {
      toast.loading("Processing your subscription...", { id: "subscribe" });
    },
    onSuccess: (data) => {
      toast.success("Redirecting to checkout!", { id: "subscribe" });

      // Use the callback URL if available, otherwise fall back to the original URL

      // Prioritize callbackUrl to ensure we return to our app
      const redirectUrl = data.url;

      // Open in the same window
      window.location.assign(redirectUrl);
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong.", {
        id: "subscribe",
      });
    },
  });

  // New mutation for cancelling a subscription
  const cancelMutation = useMutation({
    mutationFn: ({ subscriptionId, userId }: { subscriptionId: string; userId: string }) => {
      return cancelSubscription(subscriptionId, userId);
    },
    onMutate: () => {
      toast.loading("Cancelling subscription...", { id: "cancel" });
    },
    onSuccess: (data) => {
      toast.success(data.message, { id: "cancel" });
      // Refresh subscription status
      queryClient.invalidateQueries({ queryKey: ['subscriptionStatus'] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to cancel subscription", { id: "cancel" });
    }
  });

  // Mutation for resuming payment
  const resumePaymentMutation = useMutation({
    mutationFn: ({ subscriptionId, userId }: { subscriptionId: string; userId: string }) => {
      return resumePayment(subscriptionId, userId);
    },
    onMutate: () => {
      toast.loading("Processing your request...", { id: "resume" });
    },
    onSuccess: (data) => {
      toast.success(data.message || "Payment link generated", { id: "resume" });
      if (data.url) {
        // Open in the same window
        window.location.assign(data.url);
      }
    },
    onError: (error) => {
      toast.error(error.message || "Failed to resume payment", { id: "resume" });
    }
  });

  // Handler for cancelling a subscription
  const handleCancelSubscription = () => {
    console.log(subscriptionStatus);
    if (!userId || !subscriptionStatus?.subscriptionId) {
      toast.error("Cannot cancel subscription at this time");
      return;
    }

    if (confirm("Are you sure you want to cancel your subscription?")) {
      cancelMutation.mutate({
        subscriptionId: subscriptionStatus.subscriptionId,
        userId,
      });
    }
  };

  const handleCancelPendingSubscription = () => {
    console.log(subscriptionStatus);
    if (!userId || !subscriptionStatus?.pendingSubscriptionId) {
      toast.error("Cannot cancel subscription at this time");
      return;
    }

    if (confirm("Are you sure you want to cancel your subscription?")) {
      cancelMutation.mutate({
        subscriptionId: subscriptionStatus.pendingSubscriptionId,
        userId,
      });
    }
  };

  // Handler for resuming payment
  const handleResumePayment = () => {
    if (!userId || !subscriptionStatus?.pendingSubscriptionId) {
      toast.error("Cannot resume payment at this time");
      return;
    }

    resumePaymentMutation.mutate({
      subscriptionId: subscriptionStatus.pendingSubscriptionId,
      userId,
    });
  };

  const handleSubscribe = (planType: string) => {
    if (!userId) {
      router.push("/sign-up");
      return;
    }

    // If they already have an active subscription, inform them they can't switch
    if (subscriptionStatus?.isActive) {
      toast.error("You already have an active subscription. Please wait until it expires.");
      return;
    }

    // Create a new subscription
    mutation.mutate({ planType });
  };

  const formatDate = (dateString: string | Date | undefined) => {
    if (!dateString) return "";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };


  return (
    <div className="px-4 py-8 sm:py-12 lg:py-16">
      <Toaster position="top-right" /> {/* Optional: For toast notifications */}

      {isVerifying ? (
        <div className="max-w-md mx-auto p-8 border border-gray-200 rounded-lg shadow-md text-center">
          <h2 className="text-2xl font-bold mb-4">Verifying Payment</h2>
          <p className="text-gray-600 mb-4">
            Please wait while we verify your payment and activate your subscription...
          </p>
          <div className="w-12 h-12 border-t-4 border-emerald-500 rounded-full animate-spin mx-auto"></div>
        </div>
      ) : isLoadingStatus ? (
        <div className="max-w-md mx-auto p-8 text-center">
          <div className="w-8 h-8 border-t-4 border-emerald-500 rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking subscription status...</p>
        </div>
      ) : subscriptionStatus?.isPending ? (
        <div className="max-w-md mx-auto p-8 border border-amber-100 bg-amber-50 rounded-lg shadow-md">
          <h2 className="text-2xl font-bold mb-4 text-amber-800">Payment Pending</h2>
          <p className="text-gray-700 mb-6">
            You have a subscription that is waiting for payment completion. Would you like to complete your payment now?
          </p>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['subscriptionStatus'] })
                .then(() => {
                  // Check if subscription is still not active after refresh
                  setTimeout(() => {
                    const status = queryClient.getQueryData(['subscriptionStatus', userId]) as SubscriptionStatus | undefined;
                    if (status && !status.isActive) {
                      toast.error("Your payment is still pending. Please complete your payment to activate your subscription.");
                    }
                  }, 1000); // Small delay to ensure query completes
                });
            }}
            className="w-full py-2 px-4 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors mb-4"
          >
            Check Again
          </button>

          <button
            onClick={handleCancelPendingSubscription}
            className="w-full py-2 px-4 border border-red-300 text-red-700 rounded-md font-medium hover:bg-red-50 transition-colors"
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? "Processing..." : "Cancel Subscription"}
          </button>

          <button
            onClick={handleResumePayment}
            className="w-full py-2 px-4 bg-amber-500 text-white rounded-md font-medium hover:bg-amber-600 transition-colors"
            disabled={resumePaymentMutation.isPending}
          >
            {resumePaymentMutation.isPending ? "Processing..." : "Complete Payment"}
          </button>
        </div>

      ) : subscriptionStatus?.isActive ? (
        <div className="max-w-md mx-auto p-8 border border-emerald-100 bg-emerald-50 rounded-lg shadow-md">
          <h2 className="text-2xl font-bold mb-4 text-emerald-800">Active Subscription</h2>
          <p className="text-gray-700 mb-2">
            You are currently subscribed to the <span className="font-semibold">{subscriptionStatus.subscriptionTier} plan</span>.
          </p>
          <p className="text-gray-700 mb-2">
            Your subscription ends on <span className="font-semibold">{formatDate(subscriptionStatus.endDate)}</span>.
          </p>
          <p className="text-gray-700 mb-6">
            You cannot switch plans until your current subscription ends. If you wish to subscribe to a different plan, please wait until your current subscription expires.
          </p>

          <button
            onClick={handleCancelSubscription}
            className="w-full py-2 px-4 border border-red-300 text-red-700 rounded-md font-medium hover:bg-red-50 transition-colors"
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? "Processing..." : "Cancel Subscription"}
          </button>

          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['subscriptionStatus'] })}
            className="w-full mt-4 py-2 px-4 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors"
          >
            Refresh Status
          </button>
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-3xl font-bold text-center mt-12 sm:text-5xl tracking-tight">
              Pricing
            </h2>
            <p className="max-w-3xl mx-auto mt-4 text-xl text-center">
              Get started on our weekly plan or upgrade to monthly or yearly when
              you’re ready.
            </p>
          </div>
          {/* Cards Container */}
          <div className="mt-12 container mx-auto space-y-12 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-x-8">
            {/* Map over availablePlans to render plan cards */}
            {availablePlans.map((plan, key) => (
              <div
                key={key}
                className="
              relative p-8 
              border border-gray-200 rounded-2xl shadow-sm 
              flex flex-col
              hover:shadow-md hover:scale-[1.02] 
              transition-transform duration-200 ease-out
            "
              >
                <div className="flex-1">
                  {/* Conditionally render "Most popular" label */}
                  {plan.isPopular && (
                    <p className="absolute top-0 py-1.5 px-4 bg-emerald-500 text-white rounded-full text-xs font-semibold uppercase tracking-wide transform -translate-y-1/2">
                      Most popular
                    </p>
                  )}
                  <h3 className="text-xl font-semibold">{plan.name}</h3>
                  <p className="mt-4 flex items-baseline">
                    <span className="text-5xl font-extrabold tracking-tight">
                      ${plan.amount}
                    </span>
                    <span className="ml-1 text-xl font-semibold">
                      /{plan.interval}
                    </span>
                  </p>
                  <p className="mt-6">{plan.description}</p>
                  <ul role="list" className="mt-6 space-y-4">
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="flex-shrink-0 w-6 h-6 text-emerald-500"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="ml-3">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  className={`${plan.interval === "month"
                    ? "bg-emerald-500 text-white  hover:bg-emerald-600 "
                    : "bg-emerald-100 text-emerald-700  hover:bg-emerald-200 "
                    }  mt-8 block w-full py-3 px-6 border border-transparent rounded-md text-center font-medium disabled:bg-gray-400 disabled:cursor-not-allowed`}
                  onClick={() => handleSubscribe(plan.interval)}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? "Please wait..." : `Subscribe ${plan.name}`}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}