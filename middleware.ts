// app/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// 1. Define your "public" routes that do NOT require authentication
const isPublicRoute = createRouteMatcher([
    "/",
    "/sign-up(.*)",
    "/subscribe(.*)",
    "/api/checkout(.*)",
    "/api/stripe-webhook(.*)",
    "/api/check-subscription(.*)",
]);

// 2. Define a route group for Meal Plan. We want to check subscription
const isMealPlanRoute = createRouteMatcher(["/mealplan(.*)"]);

// 3. Define a route group for Profile Routes (Protected but may not require subscription)
const isProfileRoute = createRouteMatcher(["/profile(.*)"]);

const isSignUpRoute = createRouteMatcher(["/sign-up(.*)"]);

// Clerk's middleware
export default clerkMiddleware(async (auth, req) => {
    const userAuth = await auth();
    const { userId } = userAuth;
    const { pathname, origin } = req.nextUrl;

    console.log("Dev", pathname, isPublicRoute(req), userId);

    // If it's the check-subscription route, skip logic to avoid loops
    if (pathname === "/api/check-subscription") {
        return NextResponse.next();
    }

    // If route is NOT public & user not signed in → redirect to /sign-up
    if (!isPublicRoute(req) && !userId) {
        return NextResponse.redirect(new URL("/sign-up", origin));
    }

    // If user is signed in and visits /sign-up → redirect to mealplan
    if (isSignUpRoute(req) && userId) {
        return NextResponse.redirect(new URL("/mealplan", origin));
    }

    // If route is mealplan or profile → check subscription via the API route
    if ((isMealPlanRoute(req) || isProfileRoute(req)) && userId) {
        try {
            // Make a POST request to our internal API
            const checkSubRes = await fetch(
                `${origin}/api/check-subscription?userId=${userId}`,
                {
                    method: "GET",
                    headers: {
                        // Forward cookies if needed for session checks
                        cookie: req.headers.get("cookie") || "",
                    },
                }
            );

            // Then parse JSON
            if (checkSubRes.ok) {
                const data = await checkSubRes.json();
                if (!data.isActive) {
                    return NextResponse.redirect(new URL("/subscribe", origin));
                }

            } else {
                // handle error
                return NextResponse.redirect(new URL("/subscribe", origin));
            }
        } catch (error) {
            console.error("Error calling /api/check-subscription:", error);
            return NextResponse.redirect(new URL("/subscribe", origin));
        }
    }

    // Otherwise allow the request
    return NextResponse.next();
});

// 4. Next.js route matching config
export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        // Always run for API routes
        "/(api|trpc)(.*)",
    ],
};