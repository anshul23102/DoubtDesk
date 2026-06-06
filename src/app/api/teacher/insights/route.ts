// src/app/api/teacher/insights/route.ts
export const dynamic = "force-dynamic";

import { db } from "@/configs/db";
import { classroomsTable, doubtsTable } from "@/configs/schema";
import { and, eq, sql } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { generateRecommendations, WeakTopic } from "@/lib/ai/recommendations";

export async function GET(req: Request) {
    try {
        const clerkUser = await currentUser();
        const email = clerkUser?.primaryEmailAddress?.emailAddress;

        if (!email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const classroomIdStr = searchParams.get("classroomId");
        if (!classroomIdStr || !/^[1-9]\d*$/.test(classroomIdStr)) {
            return NextResponse.json({ error: "classroomId is required" }, { status: 400 });
        }

        const classroomId = Number(classroomIdStr);

        const [classroom] = await db
            .select({ id: classroomsTable.id })
            .from(classroomsTable)
            .where(and(eq(classroomsTable.id, classroomId), eq(classroomsTable.teacherEmail, email)));

        if (!classroom) {
            return NextResponse.json({ error: "Forbidden: not the teacher of this classroom" }, { status: 403 });
        }

        const classroomFilter = eq(doubtsTable.classroomId, classroomId);
        // 1. Top Confusion Topics (by total doubt count) — unchanged
        const topTopics = await db
            .select({
                topic: doubtsTable.subTopic,
                subject: doubtsTable.subject,
                count: sql<number>`count(*)::int`,
            })
            .from(doubtsTable)
            .where(and(classroomFilter, sql`${doubtsTable.subTopic} IS NOT NULL`))
            .groupBy(doubtsTable.subTopic, doubtsTable.subject)
            .orderBy(sql`count(*) DESC`)
            .limit(5);

        // 2. Solved vs Unsolved Status — unchanged
        const statusDistribution = await db
            .select({
                status: doubtsTable.isSolved,
                count: sql<number>`count(*)::int`,
            })
            .from(doubtsTable)
            .where(classroomFilter)
            .groupBy(doubtsTable.isSolved);

        // 3. Subject-wise Volume — unchanged
        const subjectVolume = await db
            .select({
                subject: doubtsTable.subject,
                count: sql<number>`count(*)::int`,
            })
            .from(doubtsTable)
            .where(classroomFilter)
            .groupBy(doubtsTable.subject);

        // 4. NEW — Unresolved count per (topic, subject) pair
        const unresolvedPerTopic = await db
            .select({
                topic: doubtsTable.subTopic,
                subject: doubtsTable.subject,
                unresolvedCount: sql<number>`count(*)::int`,
            })
            .from(doubtsTable)
            .where(
                and(
                    classroomFilter,
                    sql`${doubtsTable.subTopic} IS NOT NULL`,
                    eq(doubtsTable.isSolved, "unsolved")
                )
            )
            .groupBy(doubtsTable.subTopic, doubtsTable.subject)
            .orderBy(sql`count(*) DESC`)
            .limit(5);

        // 5. NEW — Dedicated total count per (topic, subject) pair
        // Avoids relying on topTopics (top-5 only) for ratio calculations
        const totalPerTopic = await db
            .select({
                topic: doubtsTable.subTopic,
                subject: doubtsTable.subject,
                totalCount: sql<number>`count(*)::int`,
            })
            .from(doubtsTable)
            .where(
                and(
                    classroomFilter,
                    sql`${doubtsTable.subTopic} IS NOT NULL`
                )
            )
            .groupBy(doubtsTable.subTopic, doubtsTable.subject);

        // 6. NEW — Sample doubt IDs fetched per (topic, subject) pair
        // Per-pair queries prevent one dominant topic from monopolizing a global slice
        const sampleIdsByKey = new Map<string, number[]>();
        await Promise.all(
            unresolvedPerTopic.map(async (row) => {
                if (!row.topic) return;
                const rows = await db
                    .select({ id: doubtsTable.id })
                    .from(doubtsTable)
                    .where(
                        and(
                            classroomFilter,
                            eq(doubtsTable.subTopic, row.topic),
                            eq(doubtsTable.subject, row.subject),
                            eq(doubtsTable.isSolved, "unsolved")
                        )
                    )
                    .orderBy(sql`${doubtsTable.createdAt} DESC`)
                    .limit(5);
                sampleIdsByKey.set(`${row.topic}::${row.subject}`, rows.map((r) => r.id));
            })
        );

        // 7. Build WeakTopic objects for AI input
        const weakTopics: WeakTopic[] = unresolvedPerTopic.map((row) => {
            const totalEntry = totalPerTopic.find(
                (t) => t.topic === row.topic && t.subject === row.subject
            );
            const sampleIds = sampleIdsByKey.get(`${row.topic}::${row.subject}`) ?? [];

            return {
                topic: row.topic,
                subject: row.subject,
                totalCount: totalEntry?.totalCount ?? row.unresolvedCount,
                unresolvedCount: row.unresolvedCount,
                sampleDoubtIds: sampleIds,
            };
        });

        // 8. Generate AI recommendations (with graceful fallback)
        const recommendations = await generateRecommendations(weakTopics);

        return NextResponse.json({
            topTopics,
            statusDistribution,
            subjectVolume,
            recommendations,
        });

    } catch (error) {
        console.error("Teacher Insights failed:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}