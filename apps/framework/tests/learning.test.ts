import assert from 'node:assert/strict';
import test from 'node:test';
import { docArticles } from '../client/docs';
import { findLearningCourse, learningCourses, learningMinutes, learningPath } from '../client/learning';
import { documentationPageMetadata } from '../client/pageMetadata';

test('planned courses have distinct paths, realistic lessons, and live guide links', () => {
	const ids = new Set<string>();
	const articleIds = new Set(docArticles.map(article => article.id));

	for (const course of learningCourses) {
		assert.ok(!ids.has(course.id), `duplicate course ${course.id}`);
		ids.add(course.id);
		assert.equal(findLearningCourse(course.id), course);
		assert.ok(course.lessons.length >= 3);
		assert.ok(learningMinutes(course) > 0);
		assert.equal(documentationPageMetadata('learning', null, course.id).canonicalPath, learningPath(course.id));
		for (const lesson of course.lessons) {
			assert.ok(lesson.coverage.length >= 2, `${course.id}: ${lesson.title}`);
			assert.ok(articleIds.has(lesson.resource.articleId), `${course.id}: missing ${lesson.resource.articleId}`);
		}
	}

	assert.equal(documentationPageMetadata('learning').canonicalPath, '/framework/learn');
	assert.equal(documentationPageMetadata('learning', null, 'missing').robots, 'noindex, nofollow');
});
