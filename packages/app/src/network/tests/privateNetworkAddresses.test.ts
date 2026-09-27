import { describe, expect, it } from 'vitest';
import { isPrivateHostname, isPrivateIpAddress, normalizedUrlHostname } from '@db3.ai/app/network';

describe('isPrivateIpAddress', () => {
	it.each([
		'0.0.0.0',
		'10.1.2.3',
		'100.64.0.1',
		'127.0.0.1',
		'169.254.169.254',
		'172.16.0.1',
		'172.31.255.255',
		'192.0.0.8',
		'192.0.2.10',
		'192.168.1.1',
		'198.18.0.1',
		'198.51.100.7',
		'203.0.113.9',
		'224.0.0.1',
		'255.255.255.255',
	])('blocks reserved IPv4 address %s', address => {
		expect(isPrivateIpAddress(address)).toBe(true);
	});

	it.each([
		'::',
		'::1',
		'[::1]',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'::ffff:a9fe:a9fe',
		'::7f00:1',
		'::127.0.0.1',
		'64:ff9b::7f00:1',
		'64:ff9b::10.0.0.1',
		'64:ff9b:1::1',
		'2002:7f00:1::',
		'2002:c0a8:101::1',
		'2001::1',
		'2001:db8::1',
		'100::1',
		'fc00::1',
		'fd12:3456::1',
		'fe80::1',
		'fe80::1%eth0',
		'fec0::1',
		'ff02::1',
	])('blocks reserved or IPv4-embedding IPv6 address %s', address => {
		expect(isPrivateIpAddress(address)).toBe(true);
	});

	it.each([
		'93.184.216.34',
		'8.8.8.8',
		'172.32.0.1',
		'100.128.0.1',
		'::ffff:93.184.216.34',
		'64:ff9b::5db8:d822',
		'2002:5db8:d822::1',
		'2606:4700:4700::1111',
	])('allows public address %s', address => {
		expect(isPrivateIpAddress(address)).toBe(false);
	});

	it('leaves hostnames to DNS validation', () => {
		expect(isPrivateIpAddress('example.com')).toBe(false);
	});
});

describe('hostname helpers', () => {
	it('normalizes brackets, case and a trailing root dot', () => {
		expect(normalizedUrlHostname('[::1]')).toBe('::1');
		expect(normalizedUrlHostname('LocalHost.')).toBe('localhost');
	});

	it('treats localhost names as private', () => {
		expect(isPrivateHostname('localhost')).toBe(true);
		expect(isPrivateHostname('api.localhost')).toBe(true);
		expect(isPrivateHostname('localhost.example.com')).toBe(false);
	});

	it('receives canonical numeric IPv4 hosts from URL parsing', () => {
		expect(isPrivateIpAddress(new URL('http://2130706433/').hostname)).toBe(true);
		expect(isPrivateIpAddress(new URL('http://0x7f.1/').hostname)).toBe(true);
	});
});
