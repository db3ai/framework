import { describe, expect, it } from 'vitest';
import {
	ActiveProjection,
	type ProjectionFieldBuilder,
} from '../index';
import {
	TestAccount,
	TestPost,
} from './fixtures/models';

class PostSummaryProjection extends ActiveProjection {
	static override table = 'post_summary';

	static override fields(field: ProjectionFieldBuilder) {
		return {
			...field.fromModel(TestPost, {
				fields: ['id', 'title', 'metadata', 'createdAt'],
			}),

			authorEmail: field.from(TestAccount, 'email', {
				alias: 'author_email',
			}),

			authorName: field.from(TestAccount, 'name', {
				alias: 'author_name',
				default: 'Unknown',
			}),
		};
	}

	declare id: string | null;
	declare title: string | null;
	declare metadata: unknown;
	declare createdAt: Date | null;
	declare authorEmail: string | null;
	declare authorName: string | null;
}

describe('ActiveProjection', () => {
	it('hydrates display data through reused source model fields', () => {
		const projected = PostSummaryProjection.fromDb({
			id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			title: 'Projection Test',
			metadata_json: '{"published":true,"labels":["joined"]}',
			created_at: '2026-06-18T12:00:00.000Z',
			author_email: 'author@example.com',
		});

		expect(projected.title).toBe('Projection Test');
		expect(projected.authorEmail).toBe('author@example.com');
		expect(projected.authorName).toBe('Unknown');
		expect(projected.toAppData()).toMatchObject({
			title: 'Projection Test',
			metadata: {
				published: true,
				labels: ['joined'],
			},
			createdAt: expect.any(Date),
			authorEmail: 'author@example.com',
			authorName: 'Unknown',
		});
		expect(projected.toDisplayData()).toMatchObject({
			title: 'Projection Test',
			metadata: {
				published: true,
				labels: ['joined'],
			},
			createdAt: '2026-06-18T12:00:00.000Z',
			authorEmail: 'author@example.com',
			authorName: 'Unknown',
		});
	});
});
