// components/CreateProfileOnSignIn.tsx

"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

type ApiResponse = {
    message: string;
    error?: string;
};

export default function CreateProfileOnSignIn() {
    const { isLoaded, isSignedIn } = useUser();

    // Define the mutation to create a profile
    const { mutate, isPending } = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            try {
                const res = await fetch("/api/create-profile", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                });

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.error || 'Failed to create profile');
                }

                const data = await res.json();
                return data;
            } catch (error) {
                if (error instanceof Error) {
                    throw error;
                }
                throw new Error('An unexpected error occurred');
            }
        },
        onSuccess: (data) => {
            console.log(data.message);
            toast.success("Profile synchronized successfully.");
        },
        onError: (error) => {
            console.error("Error creating profile:", error.message);
            toast.error(`Error: ${error.message}`);
        },
    });

    useEffect(() => {
        if (isLoaded && isSignedIn && !isPending) {
            mutate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoaded, isSignedIn]);

    return null; // This component doesn't render anything
}