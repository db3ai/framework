import { computed, reactive, ref, watch, type Ref } from 'vue';

import type { AddProcessRequest, PackageScript, ProcessKind, QueueTopology } from '../../shared/contracts.js';
import { consoleArgs } from '../../shared/consoleArgs.js';
import { displayCommand, workerArgs, workerLabel, workerProcessName, type WorkerSelection } from '../../shared/workerArgs.js';
import { dockApi } from '../api.js';

/** What the dialog is adding. */
export type AddKind = 'queue' | 'scheduler' | 'script';

/**
 * Form state and submission for the Add process dialog.
 *
 * Loads the project's npm scripts and its queue topology whenever the project
 * changes (ignoring stale responses), and derives the exact command preview.
 *
 * @param project - The target project's id and name, or null when closed.
 * @returns Form state, derived values and `submit`.
 */
export function useAddProcess(project: Ref<{ id: string; name: string } | null>) {
	const form = reactive({
		kind: 'queue' as AddKind,
		mode: 'queues' as WorkerSelection['mode'],
		picked: [] as string[],
		excluded: [] as string[],
		pool: '',
		count: 1,
		script: '',
		interval: '',
		maxJobs: '',
		processTitle: '',
		save: true,
		start: true,
	});
	const scripts = ref<PackageScript[]>([]);
	const topology = ref<QueueTopology>({ queues: ['default'], pools: [] });
	const loading = ref(false);
	const submitting = ref(false);
	const error = ref<string | null>(null);
	let generation = 0;

	watch(() => project.value?.id, async id => {
		const current = ++generation;
		scripts.value = [];
		topology.value = { queues: ['default'], pools: [] };
		error.value = null;
		if (!id) return;
		loading.value = true;
		try {
			const [scriptResult, queueResult] = await Promise.all([dockApi.scripts(id), dockApi.queues(id)]);
			if (current !== generation) return;
			scripts.value = scriptResult.scripts;
			topology.value = queueResult;
			form.pool = queueResult.pools[0] ?? '';
			form.picked = queueResult.queues.includes('default') ? ['default'] : queueResult.queues.slice(0, 1);
			form.script = scriptResult.scripts.find(script => script.kind === 'script')?.name ?? scriptResult.scripts[0]?.name ?? '';
		} catch (failure) {
			if (current === generation) error.value = (failure as Error).message;
		} finally {
			if (current === generation) loading.value = false;
		}
	}, { immediate: true });

	const queueScript = computed(() => findScript(scripts.value, 'queue'));
	const schedulerScript = computed(() => findScript(scripts.value, 'scheduler'));

	const selection = computed<WorkerSelection>(() => {
		if (form.mode === 'pool') return { mode: 'pool', pool: form.pool };
		if (form.mode === 'all') return { mode: 'all', exclude: form.excluded };
		return { mode: 'queues', queues: form.picked };
	});

	const suggestedTitle = computed(() => workerProcessName(project.value?.name ?? 'app', selection.value));

	/** Script, args, name and kind that will be sent, or null when incomplete. */
	const plan = computed<{ script: string; args: string[]; name: string; kind: ProcessKind } | null>(() => {
		if (form.kind === 'queue') {
			if (!queueScript.value) return null;
			if (form.mode === 'pool' && !form.pool) return null;
			const args = workerArgs(selection.value, {
				interval: Number(form.interval) || undefined,
				maxJobs: Number(form.maxJobs) || undefined,
				name: form.processTitle.trim() || suggestedTitle.value,
			});
			return { script: queueScript.value, args: consoleArgs(bodyOf(queueScript.value), args), name: `queue · ${workerLabel(selection.value)}`, kind: 'queue' };
		}
		if (form.kind === 'scheduler') {
			if (!schedulerScript.value) return null;
			return { script: schedulerScript.value, args: consoleArgs(bodyOf(schedulerScript.value), ['scheduler:work']), name: 'scheduler', kind: 'scheduler' };
		}
		const script = scripts.value.find(item => item.name === form.script);
		return script ? { script: script.name, args: [], name: script.name, kind: script.kind } : null;
	});

	function bodyOf(name: string): string {
		return scripts.value.find(script => script.name === name)?.body ?? '';
	}

	const command = computed(() => (plan.value ? displayCommand(plan.value.script, plan.value.args) : ''));
	const count = computed(() => (form.kind === 'queue' ? form.count : 1));

	/**
	 * Toggles a queue chip: included queues in `queues` mode, exclusions in `all` mode.
	 *
	 * @param name - Queue name.
	 */
	function toggleQueue(name: string): void {
		const list = form.mode === 'all' ? form.excluded : form.picked;
		const index = list.indexOf(name);
		if (index === -1) list.push(name);
		else list.splice(index, 1);
	}

	/**
	 * Adds a queue name that the source scan did not find.
	 *
	 * @param name - Queue name typed by the user.
	 */
	function addQueueName(name: string): void {
		const clean = name.trim();
		if (!clean || topology.value.queues.includes(clean)) return;
		topology.value = { ...topology.value, queues: [...topology.value.queues, clean] };
		if (form.mode !== 'all') form.picked.push(clean);
	}

	/**
	 * Sends the request.
	 *
	 * @returns Whether processes were added.
	 */
	async function submit(): Promise<boolean> {
		if (!project.value || !plan.value || submitting.value) return false;
		submitting.value = true;
		error.value = null;
		try {
			const body: AddProcessRequest = { ...plan.value, count: count.value, save: form.save, start: form.start };
			await dockApi.addProcesses(project.value.id, body);
			return true;
		} catch (failure) {
			error.value = (failure as Error).message;
			return false;
		} finally {
			submitting.value = false;
		}
	}

	return {
		form,
		scripts,
		topology,
		loading,
		submitting,
		error,
		queueScript,
		schedulerScript,
		suggestedTitle,
		plan,
		command,
		count,
		toggleQueue,
		addQueueName,
		submit,
	};
}

function findScript(scripts: PackageScript[], kind: ProcessKind): string | null {
	return scripts.find(script => script.name === kind)?.name ?? scripts.find(script => script.kind === kind)?.name ?? null;
}
