// app/api/generate-mealplan/route.ts

import { NextResponse } from "next/server";
import { OpenAI } from "openai";

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1", // Ensure this is the correct baseURL for your API
    apiKey: process.env.OPENAI_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000", // Required for OpenRouter
        "X-Title": "Meal Planner App", // Optional, but helps OpenRouter track your app
    },
});

export async function POST(request: Request) {
    try {
        // Extract parameters from the request body
        const { dietType, calories, allergies, cuisine, snacks } =
            await request.json();

        const prompt = `
      You are a professional nutritionist. Create a 7-day meal plan for an individual following a ${dietType} diet aiming for ${calories} calories per day.
      
      Allergies or restrictions: ${allergies || "none"}.
      Preferred cuisine: ${cuisine || "no preference"}.
      Snacks included: ${snacks ? "yes" : "no"}.
      
      For each day, provide:
        - Breakfast
        - Lunch
        - Dinner
        ${snacks ? "- Snacks" : ""}
      
      Use simple ingredients and provide brief instructions. Include approximate calorie counts for each meal.
      
      Structure the response as a JSON object where each day is a key, and each meal (breakfast, lunch, dinner, snacks) is a sub-key. Example:
      
      {
        "Monday": {
          "Breakfast": "Oatmeal with fruits - 350 calories",
          "Lunch": "Grilled chicken salad - 500 calories",
          "Dinner": "Steamed vegetables with quinoa - 600 calories",
          "Snacks": "Greek yogurt - 150 calories"
        },
        "Tuesday": {
          "Breakfast": "Smoothie bowl - 300 calories",
          "Lunch": "Turkey sandwich - 450 calories",
          "Dinner": "Baked salmon with asparagus - 700 calories",
          "Snacks": "Almonds - 200 calories"
        }
        // ...and so on for each day
      }

      Return just the json with no extra commentaries and no backticks.
    `;

        // Send the prompt to the AI model
        const response = await openai.chat.completions.create(
            {
                model: "meta-llama/llama-4-maverick:free", // Llama 3.2 (70B) available on free tier
                messages: [
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
                temperature: 0.7, // Adjust for creativity vs. consistency
                max_tokens: 1500, // Adjust based on expected response length
            },
            {
                headers: {
                    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
                    "X-Title": "Meal Planner App",
                    "data-policy": JSON.stringify({
                        allow_content_storage: true,
                        allow_content_sensors: true
                    })
                }
            }
        );

        // Extract the AI's response
        const aiContent = response.choices[0].message.content?.trim() || '';

        // Clean the response: remove markdown code blocks if present
        let cleanedContent = aiContent;
        if (aiContent.startsWith('```json') || aiContent.startsWith('```')) {
            cleanedContent = aiContent
                .replace(/^```json\n/, '')
                .replace(/^```\n/, '')
                .replace(/\n```$/, '')
                .trim();
        }

        // Attempt to parse the AI's response as JSON
        let parsedMealPlan: { [day: string]: DailyMealPlan };
        console.log(aiContent);
        try {
            parsedMealPlan = JSON.parse(cleanedContent);
        } catch (parseError) {
            console.error("Error parsing AI response as JSON:", parseError);
            // If parsing fails, return the raw text with an error message
            return NextResponse.json(
                { error: "Failed to parse meal plan. Please try again." },
                { status: 500 }
            );
        }

        // Validate the structure of the parsedMealPlan
        if (typeof parsedMealPlan !== "object" || parsedMealPlan === null) {
            throw new Error("Invalid meal plan format received from AI.");
        }

        // Optionally, perform additional validation on the structure here

        // Return the parsed meal plan
        return NextResponse.json({ mealPlan: parsedMealPlan });
    } catch (error) {
        console.error("Error generating meal plan:", error);
        return NextResponse.json(
            { error: "Failed to generate meal plan. Please try again later." },
            { status: 500 }
        );
    }
}

// Define the DailyMealPlan interface here or import it if defined elsewhere
interface DailyMealPlan {
    Breakfast?: string;
    Lunch?: string;
    Dinner?: string;
    Snacks?: string;
}