import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalDockerHost } from '../src/assertLocalDockerHost.mjs';

test('accepts local Docker endpoints and refuses remote deployment by accident', () => {
	for (const host of ['unix:///var/run/docker.sock', 'npipe:////./pipe/docker_engine', 'tcp://127.0.0.1:2375']) assert.doesNotThrow(() => assertLocalDockerHost(host));
	for (const host of ['ssh://someone@remote-host', 'tcp://remote-host:2375', 'invalid', '']) assert.throws(() => assertLocalDockerHost(host), /local Docker engine/);
});
