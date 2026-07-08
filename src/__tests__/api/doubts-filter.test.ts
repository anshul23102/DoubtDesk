import { GET } from '@/app/api/doubts/filter/route';

jest.mock('@clerk/nextjs/server', () => ({
    currentUser: jest.fn(),
}));

jest.mock('@/lib/auth/membership-guard', () => ({
    requireAuth: jest.fn(),
    requireMembership: jest.fn(),
    parseClassroomId: (value: unknown) => {
        const n = Number(value);
        if (!Number.isSafeInteger(n) || n <= 0) {
            const { ApiError } = jest.requireActual('@/lib/errors/error-handler');
            throw new ApiError(400, 'Invalid classroom ID');
        }
        return n;
    },
}));

import { requireAuth, requireMembership } from '@/lib/auth/membership-guard';
import { ApiError } from '@/lib/errors/error-handler';

const selectResultQueue: any[] = [];

const createQueryMock = (data: any) => ({
    from: () => createQueryMock(data),
    where: () => createQueryMock(data),
    orderBy: () => createQueryMock(data),
    limit: () => Promise.resolve(data),
    then: (resolve: any) => Promise.resolve(resolve(data)),
});

jest.mock('@/configs/db', () => ({
    db: {
        select: jest.fn().mockImplementation(() => createQueryMock(selectResultQueue.shift() ?? [])),
    },
}));

describe('Doubts Filter API Endpoint (issue #733)', () => {
    beforeEach(() => {
        (requireAuth as jest.Mock).mockReset();
        (requireMembership as jest.Mock).mockReset();
        selectResultQueue.length = 0;
    });

    it('rejects unauthenticated requests', async () => {
        (requireAuth as jest.Mock).mockRejectedValue(new ApiError(401, 'Unauthorized'));

        const req = new Request('http://localhost/api/doubts/filter?classroomId=7');
        const res = await GET(req as any);
        expect(res.status).toBe(401);
    });

    it('requires classroomId', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ email: 'student@test.com' });

        const req = new Request('http://localhost/api/doubts/filter');
        const res = await GET(req as any);
        expect(res.status).toBe(400);
    });

    it('rejects callers who are not members of the classroom', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ email: 'outsider@test.com' });
        (requireMembership as jest.Mock).mockRejectedValue(new ApiError(403, 'Access denied to this classroom'));

        const req = new Request('http://localhost/api/doubts/filter?classroomId=7');
        const res = await GET(req as any);
        expect(res.status).toBe(403);
    });

    it('returns anonymized doubts for a member, filtered by subject', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ email: 'student@test.com' });
        (requireMembership as jest.Mock).mockResolvedValue({ role: 'student' });
        selectResultQueue.push([
            { id: 1, userEmail: 'author@test.com', classroomId: 7, subject: 'Physics', content: 'why?', likes: 2, isSolved: 'unsolved', createdAt: new Date() },
        ]);

        const req = new Request('http://localhost/api/doubts/filter?classroomId=7&subject=Physics');
        const res = await GET(req as any);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.count).toBe(1);
        expect(json.data[0].userEmail).toBeUndefined();
        expect(json.data[0].author).toBeDefined();
        expect(json.data[0].subject).toBe('Physics');
    });

    it('does not filter by subject when subject=All', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ email: 'student@test.com' });
        (requireMembership as jest.Mock).mockResolvedValue({ role: 'student' });
        selectResultQueue.push([
            { id: 1, userEmail: 'a@test.com', classroomId: 7, subject: 'Physics', content: 'q1', likes: 0, isSolved: 'unsolved', createdAt: new Date() },
            { id: 2, userEmail: 'b@test.com', classroomId: 7, subject: 'Math', content: 'q2', likes: 0, isSolved: 'unsolved', createdAt: new Date() },
        ]);

        const req = new Request('http://localhost/api/doubts/filter?classroomId=7&subject=All');
        const res = await GET(req as any);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.count).toBe(2);
    });
});
