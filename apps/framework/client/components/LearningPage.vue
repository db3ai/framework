<script setup lang="ts">
import { ArrowLeft, ArrowRight, BookOpen, Clock3, Film, Sparkles } from '@lucide/vue';
import { computed } from 'vue';
import { learningCourses, learningMinutes, learningPath, type LearningCourse } from '../learning';
import { documentationPath } from '../siteRoutes';

const props = defineProps<{
	course: LearningCourse | null;
}>();

const totalMinutes = computed(() => props.course ? learningMinutes(props.course) : 0);
</script>

<template>
	<main class="learning-page">
		<div class="learning-shell">
			<template v-if="!course">
				<header class="learning-intro">
					<p class="landing-section-label">db3 Framework · Learn</p>
					<h1>Learn by building.</h1>
					<p>Short, project-led video courses are being planned. Explore the lesson outlines now and use the linked written guides to start building today.</p>
					<div class="learning-notice"><Film :size="18" aria-hidden="true" /><span>Course outlines are available. Videos have not been recorded or released.</span></div>
				</header>

				<section class="learning-featured" aria-labelledby="learning-path-title">
					<div class="learning-section-heading">
						<div>
							<p class="landing-section-label">The learning path</p>
							<h2 id="learning-path-title">One app, three useful skills.</h2>
						</div>
						<p>Start with the app, add an AI feature, then learn how to use a coding assistant to extend it safely.</p>
					</div>
					<div class="learning-grid">
						<a v-for="(item, index) in learningCourses" :key="item.id" class="learning-card" :href="learningPath(item.id)" data-docs-navigation>
							<span class="learning-card-index">0{{ index + 1 }} <span>· Course outline</span></span>
							<span class="learning-card-icon"><BookOpen v-if="index === 0" :size="24" aria-hidden="true" /><Sparkles v-else-if="index === 1" :size="24" aria-hidden="true" /><Film v-else :size="24" aria-hidden="true" /></span>
							<strong>{{ item.title }}</strong>
							<span class="learning-card-summary">{{ item.summary }}</span>
							<span class="learning-card-meta">{{ item.lessons.length }} planned lessons <span aria-hidden="true">·</span> about {{ learningMinutes(item) }} min</span>
							<span class="learning-card-action">See the syllabus <ArrowRight :size="17" aria-hidden="true" /></span>
						</a>
					</div>
				</section>

				<section class="learning-priority" aria-labelledby="learning-priority-title">
					<div>
						<p class="landing-section-label">A useful first release</p>
						<h2 id="learning-priority-title">Start small. Finish the first app.</h2>
						<p>Record the setup and first working change as a pilot, then complete the core app course. The AI course follows the same codebase, so learners can see a real product feature rather than a disconnected demo.</p>
					</div>
					<a class="landing-primary-action" :href="documentationPath('starter-app')" data-docs-navigation>Use the starter guide now <ArrowRight :size="18" aria-hidden="true" /></a>
				</section>
			</template>

			<template v-else>
				<a class="learning-back" :href="learningPath()" data-docs-navigation><ArrowLeft :size="17" aria-hidden="true" /> All courses</a>
				<header class="learning-course-header">
					<p class="landing-section-label">{{ course.eyebrow }}</p>
					<h1>{{ course.title }}</h1>
					<p class="learning-course-summary">{{ course.summary }}</p>
					<div class="learning-course-meta"><span><Film :size="17" aria-hidden="true" /> {{ course.lessons.length }} planned videos</span><span><Clock3 :size="17" aria-hidden="true" /> About {{ totalMinutes }} min</span><span>Outline available · videos to come</span></div>
				</header>

				<div class="learning-course-layout">
					<section class="learning-lessons" aria-labelledby="learning-lessons-title">
						<h2 id="learning-lessons-title">Lesson outline</h2>
						<p class="learning-lessons-intro">Each lesson is a proposed recording brief. The written guide beside it is available now.</p>
						<ol>
							<li v-for="(lesson, index) in course.lessons" :key="lesson.title" class="learning-lesson">
								<div class="learning-lesson-number">{{ String(index + 1).padStart(2, '0') }}</div>
								<div class="learning-lesson-body">
									<div class="learning-lesson-heading"><h3>{{ lesson.title }}</h3><span>~{{ lesson.minutes }} min</span></div>
									<p>{{ lesson.summary }}</p>
									<ul><li v-for="point in lesson.coverage" :key="point">{{ point }}</li></ul>
									<a :href="documentationPath(lesson.resource.articleId)" data-docs-navigation>{{ lesson.resource.label }} <ArrowRight :size="15" aria-hidden="true" /></a>
								</div>
							</li>
						</ol>
					</section>
					<aside class="learning-course-aside" aria-label="Course details">
						<h2>What you will build</h2><p>{{ course.project }}</p>
						<h2>Who it is for</h2><p>{{ course.audience }}</p>
						<h2>Before you start</h2><p>{{ course.prerequisite }}</p>
						<h2>Production plan</h2><p>{{ course.priority }}</p>
					</aside>
				</div>
			</template>
		</div>
	</main>
</template>
