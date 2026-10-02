<script setup lang="ts">
import { ArrowRight, Bot, Braces, ServerCog, Workflow } from '@lucide/vue';
import { markRaw } from 'vue';
import { landingCapabilities, landingUseCases } from '../landing';
import { documentationPath } from '../siteRoutes';
import FrameworkDiagram from './FrameworkDiagram.vue';

const useCaseIcons = [markRaw(Braces), markRaw(Bot), markRaw(ServerCog), markRaw(Workflow)];

</script>

<template>
	<main class="landing-page">
		<section class="landing-hero" aria-labelledby="landing-title">
			<div class="landing-hero-copy">
				<h1 id="landing-title">The TypeScript framework for apps with AI.</h1>
				<p class="landing-hero-summary">Build agents that call your functions, remember conversations and work with your data. Add images, embeddings and background jobs through the same framework.</p>
				<div class="landing-hero-actions">
					<a class="landing-primary-action" :href="documentationPath('welcome')" data-docs-navigation>
						Read the docs
						<ArrowRight :size="18" aria-hidden="true" />
					</a>
					<a class="landing-secondary-action" :href="documentationPath('ai')" data-docs-navigation>Explore AI</a>
				</div>
			</div>

			<FrameworkDiagram />
		</section>

		<section class="landing-capabilities" aria-labelledby="capabilities-title">
			<div class="landing-capabilities-intro">
				<h2 id="capabilities-title">Everything your product needs</h2>
			</div>

			<div class="landing-capability-list">
				<a
					v-for="capability in landingCapabilities"
					:key="capability.title"
					class="landing-capability-row"
					:href="documentationPath(capability.target)"
					data-docs-navigation
				>
					<component :is="capability.icon" :size="25" :stroke-width="1.7" aria-hidden="true" />
					<strong>{{ capability.title }}</strong>
					<span>{{ capability.description }}</span>
					<small>Learn more <ArrowRight :size="15" aria-hidden="true" /></small>
				</a>
			</div>
		</section>

		<section class="landing-use-cases" aria-labelledby="use-cases-title">
			<div class="landing-use-cases-header">
				<p class="landing-section-label">Built for real product work</p>
				<h2 id="use-cases-title">One framework, many product shapes.</h2>
				<p>Start with the services your product needs today and keep the same application model as it grows.</p>
			</div>

			<div class="landing-use-case-grid">
				<a
					v-for="(useCase, index) in landingUseCases"
					:key="useCase.title"
					class="landing-use-case"
					:href="documentationPath(useCase.target)"
					data-docs-navigation
				>
					<component :is="useCaseIcons[index]" :size="24" :stroke-width="1.6" aria-hidden="true" />
					<strong>{{ useCase.title }}</strong>
					<span>{{ useCase.description }}</span>
					<small>Explore this path <ArrowRight :size="15" aria-hidden="true" /></small>
				</a>
			</div>
		</section>

		<section class="landing-final-cta" aria-labelledby="landing-cta-title">
			<p class="landing-section-label">Start with the framework</p>
			<h2 id="landing-cta-title">Build the product, not another runtime.</h2>
			<p>Follow the first application guide, then explore each service through source-backed documentation and verified examples.</p>
			<div class="landing-hero-actions">
				<a class="landing-primary-action" :href="documentationPath('starter-app')" data-docs-navigation>Create your first app <ArrowRight :size="18" aria-hidden="true" /></a>
				<a class="landing-secondary-action" :href="documentationPath('api-reference')" data-docs-navigation>Browse the API</a>
			</div>
		</section>
	</main>
</template>
