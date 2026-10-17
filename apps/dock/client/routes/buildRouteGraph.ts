import type { ContainerSnapshot, HostSnapshot, SlotGroup } from '../../shared/hostContracts.js';
import { containerLabel } from '../hosts/presentation.js';

/**
 * The Routes view's graph: how requests reach containers on one server, read
 * only from a {@link HostSnapshot}. It has no state of its own, so the view can
 * change or go without touching anything else.
 *
 * Columns follow roles, not names: entry points (tunnel hostnames, ports
 * published beyond loopback) → tunnels → proxies → destinations. A
 * destination inside a blue/green or release slot is drawn as the slot. Empty
 * columns are dropped, so a server without tunnels starts at its published ports.
 */

/** Column of a node, left to right. */
export type RouteColumn = 'entry' | 'tunnel' | 'proxy' | 'destination';

/** Health of a node or edge. */
export type RouteState = 'live' | 'standby' | 'idle' | 'broken';

export interface RouteNode {
	/** Stable across samples, so the view does not jump: `host:growthscout.io`, `container:scout-gateway-1`, `slot:scout-blue`. */
	id: string;
	column: RouteColumn;
	kind: 'hostname' | 'catch-all' | 'port' | 'container' | 'slot' | 'missing';
	label: string;
	/** Second line: the real container name under a deployment title, a slot's release, a missing target. */
	sublabel: string | null;
	state: RouteState;
	/** Container shown when the node is clicked. */
	select: string | null;
	container: ContainerSnapshot | null;
	slot: (SlotGroup & { running: number; total: number; problem: string | null }) | null;
	/** Proxy rules listed when the node is expanded: `/assets/` → `scout_active` → blue. */
	rules: Array<{ path: string; target: string; fallback: string | null; state: RouteState }>;
	/** For a container inside an expanded slot: the slot node it sits in. */
	parent: string | null;
	/** For an expanded slot: its containers' node ids, in display order. */
	members: string[];
	/** Position, relative to the parent for a slot member. */
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RouteEdge {
	id: string;
	source: string;
	target: string;
	/** `live` routes animate; `standby` is a previous upstream; `broken` leads nowhere. */
	state: RouteState;
	/** Upstream name, when the route goes through one. */
	label: string | null;
	/** For a tunnel's routes: the hostnames (`*` for its catch-all) that take this route. */
	hosts?: string[];
	/** Colour of the blue or green slot the route leads into, so lines match their slot. */
	tint?: 'blue' | 'green';
}

export interface RouteGraph {
	nodes: RouteNode[];
	edges: RouteEdge[];
}

/** Geometry, shared with the node component so its size matches the layout. */
export const ROUTE_LAYOUT = {
	width: 270,
	columnGap: 90,
	rowGap: 22,
	/** A box without rules: two lines of text, or three with the rules toggle. */
	baseHeight: 64,
	toggleHeight: 18,
	/** Each rule is a path line and a target line; a fallback adds one more. */
	ruleHeight: 32,
	fallbackHeight: 15,
	rulesPadding: 12,
	/** An expanded slot holds one compact row per container. */
	memberHeight: 44,
	memberGap: 6,
	memberPadding: 10,
};

/**
 * @param host - Server snapshot.
 * @param options - Proxies (by container name) and slots (by compose project)
 *   that are expanded, and a filter that keeps only paths touching matching
 *   containers or hostnames, and the box width (defaults to {@link ROUTE_LAYOUT}).
 * @returns Positioned nodes and edges.
 */
export function buildRouteGraph(host: HostSnapshot, options: { expanded?: Set<string>; filter?: string; width?: number } = {}): RouteGraph {
	const containers = new Map(host.containers.map(container => [container.name, container]));
	const slots = new Map(host.apps.flatMap(app => app.slots).map(slot => [slot.id, slot]));
	const nodes = new Map<string, RouteNode>();
	const edges = new Map<string, RouteEdge>();

	const node = (partial: Omit<RouteNode, 'x' | 'y' | 'width' | 'height' | 'rules' | 'sublabel' | 'select' | 'container' | 'slot' | 'parent' | 'members'> & Partial<RouteNode>): RouteNode => {
		const existing = nodes.get(partial.id);
		if (existing) return existing;
		const created: RouteNode = { sublabel: null, select: null, container: null, slot: null, rules: [], parent: null, members: [], x: 0, y: 0, width: ROUTE_LAYOUT.width, height: ROUTE_LAYOUT.baseHeight, ...partial };
		nodes.set(created.id, created);
		return created;
	};
	const edge = (source: string, target: string, state: RouteState, label: string | null = null, host?: string) => {
		const id = `${source}->${target}`;
		const known = edges.get(id);
		const hosts = host ? [...new Set([...(known?.hosts ?? []), host])] : known?.hosts;
		// One line per pair; the strongest state wins (an active route beats a fallback).
		const strongest = !known || rank(state) > rank(known.state) ? state : known.state;
		edges.set(id, { id, source, target, state: strongest, label: known?.label ?? label, ...(hosts ? { hosts } : {}) });
	};

	const containerNode = (container: ContainerSnapshot, column: RouteColumn) => node({
		id: `container:${container.name}`,
		column,
		kind: 'container',
		label: container.title ?? container.name,
		sublabel: container.title ? container.name : null,
		state: containerState(container),
		select: container.name,
		container,
	});
	/**
	 * Where a route into this container is drawn: the container itself, or its
	 * slot, or (when the slot is expanded) its own box inside the slot.
	 */
	const destinationFor = (container: ContainerSnapshot): RouteNode => {
		const slot = container.slot ? slots.get(container.slot) : undefined;
		if (!slot) return containerNode(container, isProxy(container) ? 'proxy' : container.role === 'tunnel' ? 'tunnel' : 'destination');
		const slotNode = slotNodeFor(slot);
		return slotNode.members.length ? nodes.get(`container:${container.name}`)! : slotNode;
	};
	const slotNodeFor = (slot: SlotGroup): RouteNode => {
		const existing = nodes.get(`slot:${slot.id}`);
		if (existing) return existing;
		const members = slot.containers.map(name => containers.get(name)).filter((item): item is ContainerSnapshot => !!item);
		const entry = members.find(member => member.routesIn.some(route => !containers.get(route.from)?.slot)) ?? members[0]!;
		const slotNode = node({
			id: `slot:${slot.id}`,
			column: 'destination',
			kind: 'slot',
			label: slot.id,
			sublabel: slot.release && slot.release !== slot.label ? slot.release : null,
			state: slot.state === 'live' ? 'live' : slot.state === 'standby' ? 'standby' : 'idle',
			select: entry.name,
			slot: { ...slot, running: members.filter(member => member.state === 'running').length, total: members.length, problem: slotProblem(members) },
		});
		if (options.expanded?.has(slot.id)) {
			const count = (member: ContainerSnapshot) => members.filter(other => other.service === member.service).length;
			for (const member of members) {
				const child = node({
					id: `container:${member.name}`,
					column: 'destination',
					kind: 'container',
					label: containerLabel(member, count(member) > 1),
					sublabel: member.name,
					state: containerState(member),
					select: member.name,
					container: member,
					parent: slotNode.id,
				});
				slotNode.members.push(child.id);
			}
			// Routes between the slot's own containers: web → api.
			for (const member of members) {
				for (const route of member.routesIn) {
					if (members.some(other => other.name === route.from)) edge(`container:${route.from}`, `container:${member.name}`, route.role === 'previous' ? 'standby' : containerState(member), route.upstream);
				}
			}
		}
		return slotNode;
	};
	// Every slot appears, routed or not, so an idle one can be expanded and managed too.
	for (const slot of slots.values()) slotNodeFor(slot);

	// Tunnels and the hostnames they serve.
	for (const tunnel of host.containers.filter(container => container.role === 'tunnel')) {
		const tunnelNode = containerNode(tunnel, 'tunnel');
		for (const rule of tunnel.tunnel?.ingress ?? []) {
			if (!/^https?:/.test(rule.service)) continue;
			const entry = rule.hostname
				? node({ id: `host:${rule.hostname}`, column: 'entry', kind: 'hostname', label: rule.hostname, state: tunnelNode.state })
				: node({ id: `any:${tunnel.name}`, column: 'entry', kind: 'catch-all', label: 'Any other hostname', sublabel: `catch-all of ${tunnel.name}`, state: tunnelNode.state });
			const host = rule.hostname ?? '*';
			edge(entry.id, tunnelNode.id, tunnelNode.state, null, host);
			if (!rule.targets.length) {
				const missing = node({ id: `missing:${rule.service}`, column: 'destination', kind: 'missing', label: rule.service, sublabel: 'no running container answers', state: 'broken' });
				edge(tunnelNode.id, missing.id, 'broken', null, host);
			}
			for (const name of rule.targets) {
				const target = containers.get(name);
				if (target) edge(tunnelNode.id, destinationFor(target).id, tunnelNode.state === 'live' ? containerState(target) : 'idle', null, host);
			}
		}
	}

	// Ports published beyond loopback take traffic directly.
	for (const container of host.containers) {
		if (container.state !== 'running') continue;
		for (const port of container.ports) {
			if (!port.hostPort || port.hostIp === '127.0.0.1' || port.hostIp === '::1') continue;
			const entry = node({ id: `port:${port.hostPort}`, column: 'entry', kind: 'port', label: `:${port.hostPort}`, sublabel: `published by ${container.name}`, state: 'live' });
			edge(entry.id, destinationFor(container).id, containerState(container));
		}
	}

	// Proxies outside slots: their routes, and their rules for when they are expanded.
	for (const proxy of host.containers.filter(isProxy)) {
		const proxyNode = containerNode(proxy, 'proxy');
		for (const target of host.containers) {
			for (const route of target.routesIn) {
				if (route.from !== proxy.name) continue;
				const destination = destinationFor(target);
				if (destination.id === proxyNode.id) continue;
				edge(proxyNode.id, destination.id, route.role === 'previous' ? 'standby' : proxyNode.state === 'live' ? containerState(target) : 'idle', route.upstream);
			}
		}
		if (options.expanded?.has(proxy.name)) proxyNode.rules = proxyRules(proxy, containers, slots);
	}

	// Lines into a blue or green slot (or a container inside one) take its colour.
	for (const item of edges.values()) {
		const target = nodes.get(item.target);
		const slotNode = target?.parent ? nodes.get(target.parent) : target;
		const colour = slotNode?.slot?.label;
		if (colour === 'blue' || colour === 'green') item.tint = colour;
	}
	let graph = { nodes: [...nodes.values()], edges: [...edges.values()] };
	if (options.filter?.trim()) graph = filterGraph(graph, options.filter);
	return layout(graph, clampWidth(options.width));
}

function isProxy(container: ContainerSnapshot): boolean {
	return !container.slot && container.role !== 'tunnel' && !!container.proxy && (container.proxy.upstreams.length > 0 || container.routesIn.length > 0 || container.proxy.servers.length > 0);
}

function containerState(container: ContainerSnapshot): RouteState {
	if (container.state !== 'running' || container.health === 'unhealthy') return 'broken';
	return container.traffic === 'live' ? 'live' : container.traffic === 'standby' ? 'standby' : 'idle';
}

/** Why a routed slot could not serve properly, if it couldn't. */
function slotProblem(members: ContainerSnapshot[]): string | null {
	const unhealthy = members.find(member => member.state === 'running' && member.health === 'unhealthy');
	if (unhealthy) return `${unhealthy.service ?? unhealthy.name} unhealthy`;
	const api = members.find(member => member.role === 'api' && member.state !== 'running');
	if (api) return `${api.service ?? api.name} stopped`;
	return null;
}

function proxyRules(proxy: ContainerSnapshot, containers: Map<string, ContainerSnapshot>, slots: Map<string, SlotGroup>): RouteNode['rules'] {
	const rules: RouteNode['rules'] = [];
	const describe = (names: string[]) => [...new Set(names.map(name => {
		const container = containers.get(name);
		return container?.slot && slots.has(container.slot) ? container.slot : name;
	}))].join(', ');
	for (const server of proxy.proxy?.servers ?? []) {
		for (const location of server.locations) {
			// Named locations are only reached through another rule's fallback, shown there.
			if (location.path.startsWith('@')) continue;
			const fallback = location.fallback ? server.locations.find(item => item.path === location.fallback) : undefined;
			const targets = location.targets.map(name => containers.get(name)).filter((item): item is ContainerSnapshot => !!item);
			rules.push({
				path: location.path,
				target: location.proxyPass ? `${location.proxyPass}${targets.length ? ` → ${describe(location.targets)}` : ''}` : location.returns ? `return ${location.returns.replace(/\\n|\s+/g, ' ').trim()}` : 'served here',
				fallback: fallback ? `${location.fallback} → ${describe(fallback.targets) || fallback.proxyPass || '—'}` : null,
				state: location.proxyPass && !targets.length ? 'broken' : targets.some(target => target.traffic === 'live') ? 'live' : 'idle',
			});
		}
	}
	return rules;
}

/** Keeps the nodes matching the filter, with everything upstream and downstream of them. */
function filterGraph(graph: RouteGraph, filter: string): RouteGraph {
	const needle = filter.trim().toLowerCase();
	const matches = graph.nodes.filter(item => [item.label, item.sublabel ?? '', item.select ?? '', item.container?.app ?? '', ...(item.slot?.containers ?? [])].some(text => text.toLowerCase().includes(needle)));
	const { nodes, edges } = routesThrough(graph, matches.map(item => item.id));
	// A slot and the containers drawn inside it stay together.
	for (const item of graph.nodes) {
		if (item.parent && nodes.has(item.id)) nodes.add(item.parent);
	}
	for (const item of graph.nodes) {
		if (item.parent && nodes.has(item.parent)) nodes.add(item.id);
	}
	return { nodes: graph.nodes.filter(item => nodes.has(item.id)), edges: graph.edges.filter(item => nodes.has(item.source) && nodes.has(item.target) && (edges.has(item.id) || !!graph.nodes.find(node => node.id === item.target)?.parent)) };
}

/**
 * The routes passing through some nodes: everything upstream and downstream of
 * them, walked separately so a sibling (another slot behind the same gateway)
 * is left out. A shared tunnel is crossed only along the hostnames of the
 * route that entered it, so growthscout.io does not lead to db3.ai's
 * destinations, or back again.
 *
 * @param graph - Route graph.
 * @param ids - Node ids to start from.
 * @returns Ids of the nodes and edges on those routes.
 */
export function routesThrough(graph: RouteGraph, ids: string[]): { nodes: Set<string>; edges: Set<string> } {
	const nodes = new Set<string>(ids);
	const edges = new Set<string>();
	const byId = new Map(graph.nodes.map(item => [item.id, item]));
	for (const forward of [true, false]) {
		const seen = new Set<string>();
		const queue: Array<{ id: string; hosts?: string[] }> = ids.map(id => ({ id }));
		while (queue.length) {
			const { id, hosts } = queue.shift()!;
			const key = `${id}|${hosts?.join(',') ?? ''}`;
			if (seen.has(key)) continue;
			seen.add(key);
			nodes.add(id);
			for (const item of graph.edges) {
				const [from, to] = forward ? [item.source, item.target] : [item.target, item.source];
				if (from !== id) continue;
				const shared = item.hosts && hosts ? item.hosts.filter(host => hosts.includes(host)) : item.hosts;
				if (shared && !shared.length) continue;
				edges.add(item.id);
				queue.push({ id: to, hosts: byId.get(to)?.column === 'tunnel' ? shared : undefined });
			}
		}
	}
	return { nodes, edges };
}

/**
 * What stays bright when a box is in focus (hovered, clicked, or an expanded
 * slot): the routes through it. An expanded slot counts as a selection of
 * everything in it, so routes into any of its containers stay lit, and none of
 * its containers, or the lines between them, fade while it or one of them is
 * on the route.
 *
 * @param graph - Route graph.
 * @param id - Focused node id.
 * @returns Ids of the nodes and edges to keep bright.
 */
export function focusOn(graph: RouteGraph, id: string): { nodes: Set<string>; edges: Set<string> } {
	const byId = new Map(graph.nodes.map(item => [item.id, item]));
	const through = routesThrough(graph, [id, ...(byId.get(id)?.members ?? [])]);
	const slots = new Set<string>();
	for (const kept of through.nodes) {
		const item = byId.get(kept);
		if (item?.parent) slots.add(item.parent);
		if (item?.members.length) slots.add(item.id);
	}
	for (const slot of slots) {
		through.nodes.add(slot);
		for (const member of byId.get(slot)?.members ?? []) through.nodes.add(member);
	}
	for (const edge of graph.edges) {
		const parent = byId.get(edge.source)?.parent;
		if (parent && parent === byId.get(edge.target)?.parent && slots.has(parent)) through.edges.add(edge.id);
	}
	return through;
}

const COLUMNS: RouteColumn[] = ['entry', 'tunnel', 'proxy', 'destination'];

/**
 * Places nodes in their columns. Each column is ordered by the average position
 * of the nodes feeding it (the barycentre heuristic), which keeps most lines
 * from crossing; ties fall back to the label so the order is stable.
 */
/** Narrowest and widest box the width setting allows. */
export const ROUTE_WIDTH_RANGE = { min: 220, max: 520 };

function clampWidth(width: number | undefined): number {
	if (!width || !Number.isFinite(width)) return ROUTE_LAYOUT.width;
	return Math.min(ROUTE_WIDTH_RANGE.max, Math.max(ROUTE_WIDTH_RANGE.min, Math.round(width)));
}

function layout(graph: RouteGraph, width: number): RouteGraph {
	// Slot members are placed inside their slot, after the columns.
	const columns = COLUMNS.map(column => graph.nodes.filter(item => item.column === column && !item.parent)).filter(list => list.length);
	const order = new Map<string, number>();
	// A route into a slot member counts as a route into its slot.
	const parentOf = new Map(graph.nodes.filter(item => item.parent).map(item => [item.id, item.parent!]));
	const incoming = (id: string) => graph.edges.filter(item => (parentOf.get(item.target) ?? item.target) === id).map(item => order.get(parentOf.get(item.source) ?? item.source)).filter((value): value is number => value !== undefined);
	const outgoing = (id: string) => graph.edges.filter(item => item.source === id).map(item => item.target);

	// Entries have no sources: order them by the tunnel or destination they feed, then by name.
	const firstTargets = new Map<string, string>();
	for (const item of columns[0] ?? []) firstTargets.set(item.id, outgoing(item.id).sort()[0] ?? '');
	columns[0]?.sort((a, b) => firstTargets.get(a.id)!.localeCompare(firstTargets.get(b.id)!) || stateRank(a) - stateRank(b) || a.label.localeCompare(b.label));
	columns[0]?.forEach((item, index) => order.set(item.id, index));

	for (const column of columns.slice(1)) {
		const centre = (id: string) => {
			const sources = incoming(id);
			return sources.length ? sources.reduce((sum, value) => sum + value, 0) / sources.length : Number.MAX_SAFE_INTEGER;
		};
		column.sort((a, b) => centre(a.id) - centre(b.id) || stateRank(a) - stateRank(b) || a.label.localeCompare(b.label));
		column.forEach((item, index) => order.set(item.id, order.size + index));
	}

	columns.forEach((column, index) => {
		let y = 0;
		for (const item of column) {
			item.height = routeNodeHeight(item);
			item.width = width;
			item.x = index * (width + ROUTE_LAYOUT.columnGap);
			item.y = y;
			y += item.height + ROUTE_LAYOUT.rowGap;
		}
	});
	const byId = new Map(graph.nodes.map(item => [item.id, item]));
	for (const parent of graph.nodes.filter(item => item.members.length)) {
		parent.members.forEach((id, index) => {
			const member = byId.get(id);
			if (!member) return;
			member.x = ROUTE_LAYOUT.memberPadding;
			member.y = ROUTE_LAYOUT.baseHeight + ROUTE_LAYOUT.toggleHeight + index * (ROUTE_LAYOUT.memberHeight + ROUTE_LAYOUT.memberGap);
			member.width = width - 2 * ROUTE_LAYOUT.memberPadding;
			member.height = ROUTE_LAYOUT.memberHeight;
		});
	}
	return graph;
}

/**
 * @param item - Node.
 * @returns Its height: one row per rule, plus a line for each rule's fallback.
 */
export function routeNodeHeight(item: Pick<RouteNode, 'rules' | 'container' | 'members' | 'kind'>): number {
	if (item.kind === 'slot') {
		const rows = item.members.length;
		return ROUTE_LAYOUT.baseHeight + ROUTE_LAYOUT.toggleHeight + (rows ? rows * (ROUTE_LAYOUT.memberHeight + ROUTE_LAYOUT.memberGap) + ROUTE_LAYOUT.memberPadding - ROUTE_LAYOUT.memberGap : 0);
	}
	const toggle = item.container?.proxy?.servers.length ? ROUTE_LAYOUT.toggleHeight : 0;
	if (!item.rules.length) return ROUTE_LAYOUT.baseHeight + toggle;
	const fallbacks = item.rules.filter(rule => rule.fallback).length;
	return ROUTE_LAYOUT.baseHeight + toggle + ROUTE_LAYOUT.rulesPadding + item.rules.length * ROUTE_LAYOUT.ruleHeight + fallbacks * ROUTE_LAYOUT.fallbackHeight;
}

function rank(state: RouteState): number {
	return { broken: 0, idle: 1, standby: 2, live: 3 }[state];
}

/** Live first, broken last, within a column. */
function stateRank(item: RouteNode): number {
	return 3 - rank(item.state) + (item.state === 'broken' ? 4 : 0);
}
