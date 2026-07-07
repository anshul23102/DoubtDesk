import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/configs/db";
import { doubtsTable, repliesTable } from "@/configs/schema";
import { eq } from "drizzle-orm";
import { createReplyNotification } from "@/lib/notifications/service";
import { buildErrorResponse } from "@/lib/error-handler";

// Manually (re-)trigger a "doubt answered" notification for a given reply.
// The reply flow (src/app/api/replies/route.ts) already fires this
// automatically on every new reply via the real, persisted + SSE-pushed
// notification pipeline (createReplyNotification -> notificationsTable +
// realtime.ts). This endpoint exists for cases where that needs to be
// re-triggered manually (e.g. a client-side delivery failure) — it looks
// up the doubt/reply from the database rather than trusting client-supplied
// content, and only the reply's own author may trigger it.
export async function POST(req: NextRequest) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const email = user.primaryEmailAddress.emailAddress;

        const body = await req.json();
        const { doubtId, replyId } = body as { doubtId: number; replyId: number };

        if (!doubtId || !Number.isInteger(doubtId) || !replyId || !Number.isInteger(replyId)) {
            return NextResponse.json({ error: "doubtId and replyId are required" }, { status: 400 });
        }

        const [doubt] = await db
            .select()
            .from(doubtsTable)
            .where(eq(doubtsTable.id, doubtId));

        if (!doubt) {
            return NextResponse.json({ error: "Doubt not found" }, { status: 404 });
        }

        const [reply] = await db
            .select()
            .from(repliesTable)
            .where(eq(repliesTable.id, replyId));

        if (!reply || reply.doubtId !== doubtId) {
            return NextResponse.json({ error: "Reply not found" }, { status: 404 });
        }

        if (reply.userEmail !== email) {
            return NextResponse.json({ error: "Forbidden: only the reply author can trigger this notification" }, { status: 403 });
        }

        const created = await createReplyNotification({
            doubtId,
            replyId,
            doubtOwnerEmail: doubt.userEmail || null,
            replierEmail: reply.userEmail,
            doubtTitle: doubt.subject || doubt.content || "your doubt",
            replierName: user.fullName || email,
            replyContent: reply.content || "",
            classroomId: doubt.classroomId || null,
            doubtType: doubt.type ?? "community",
        });

        return NextResponse.json({
            success: true,
            message: created.length > 0 ? "Notification sent" : "No notification needed (self-reply or no recipient)",
            notification: created[0] ?? null,
        });
    } catch (error) {
        const { status, body } = buildErrorResponse(error);
        return NextResponse.json(body, { status });
    }
}
