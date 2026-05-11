import { Groq } from "groq-sdk";
import { db } from "@/configs/db";
import { usersTable, moderationLogsTable } from "@/configs/schema";
import { eq } from "drizzle-orm";
import { sendWarningEmail, sendBlockEmail } from "./email";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

/**
 * Moderation result object representing the safety status of content.
 */
export interface ModerationResult {
    isAllowed: boolean;
    reason: string;
    violationType?: 'abusive' | 'off-topic' | 'spam' | 'other';
}

/**
 * Uses a Large Language Model to moderate content for academic appropriateness.
 * Checks for:
 * - Academic relevance (study-related, career, tech)
 * - Abusive language, hate speech, or harassment
 * - Spam or inappropriate non-academic topics
 * 
 * @param content The text to analyze
 * @returns A ModerationResult indicating if the content is safe and why
 */
export async function moderateContent(content: string): Promise<ModerationResult> {
    if (!content || content.trim().length === 0) {
        return { isAllowed: true, reason: "Empty content" };
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a content moderator for an academic platform called DoubtDesk. 
                    Your task is to analyze if the provided content is related to studies, academic subjects, career guidance, or technical questions.
                    You must also check for abusive language, hate speech, harassment, or inappropriate non-academic content.
                    
                    Return a JSON object with:
                    {
                        "isAllowed": boolean,
                        "reason": "short explanation in English",
                        "violationType": "abusive" | "off-topic" | "spam" | "other" (only if isAllowed is false)
                    }`
                },
                {
                    role: "user",
                    content: `Analyze this content: "${content}"`
                }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");
        return {
            isAllowed: result.isAllowed ?? true,
            reason: result.reason ?? "Content looks good",
            violationType: result.violationType
        };
    } catch (error) {
        console.error("Moderation error:", error);
        // Fallback to allow if AI fails, to avoid blocking legitimate users
        return { isAllowed: true, reason: "Moderation service unavailable" };
    }
}

/**
 * Handles the persistence of moderation violations.
 * Updates user strike count, logs the violation, and returns an error message if blocked.
 * 
 * @param email User's email
 * @param content The flagged content
 * @param moderation The result from moderateContent
 * @returns An error message string if violation handled, or null if allowed
 */
export async function handleModerationViolation(
    email: string,
    content: string,
    moderation: ModerationResult
): Promise<string | null> {
    if (moderation.isAllowed) return null;

    // 1. Fetch current user state
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    
    // 2. Increment strikes
    const newViolationCount = (dbUser?.violationCount || 0) + 1;
    const isThirdViolation = newViolationCount >= 3;
    let blockedUntil: Date | null = dbUser?.blockedUntil || null;
    let newBlockCount = dbUser?.blockCount || 0;

    if (isThirdViolation) {
        newBlockCount += 1;
        // Duration: 3 days (1st block), 7 days (2nd), 14*2^n (others)
        let durationDays = 3;
        if (newBlockCount === 2) durationDays = 7;
        else if (newBlockCount >= 3) durationDays = 14 * Math.pow(2, newBlockCount - 3);

        blockedUntil = new Date();
        blockedUntil.setDate(blockedUntil.getDate() + durationDays);
        
        // Send Block Email
        await sendBlockEmail(email, durationDays, newBlockCount);
    }

    // 3. Update User Table
    await db.update(usersTable)
        .set({ 
            violationCount: newViolationCount,
            isBlocked: isThirdViolation,
            blockedUntil: blockedUntil,
            blockCount: newBlockCount
        })
        .where(eq(usersTable.email, email));

    // 4. Log Violation to moderation_logs
    await db.insert(moderationLogsTable).values({
        userEmail: email,
        reason: moderation.reason,
        violationType: moderation.violationType || 'other',
        contentSnippet: content.substring(0, 200)
    });

    // 5. Send Warning Email
    await sendWarningEmail(email, moderation.reason, newViolationCount);

    // 6. Generate Error Message for UI
    let errorMessage = `Content flagged: ${moderation.reason}. This is strike ${newViolationCount}/3. Please stick to academic topics.`;
    if (isThirdViolation && blockedUntil) {
        const unlockDate = blockedUntil.toDateString();
        errorMessage = `Content flagged. Your account is now blocked for ${newBlockCount > 1 ? 'additional ' : ''}violations. Access restored on ${unlockDate}.`;
    }

    return errorMessage;
}
