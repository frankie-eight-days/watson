/**
 * @watson/shared — THE CONTRACT.
 *
 * Frozen shared types + the emitEvent client. Every tab imports from here and
 * treats it as read-only. Changes only via the architect session.
 *
 * See packages/shared/README.md for the protocol, hard rules, the emit endpoint
 * contract, and how to use the mock fixture.
 */

export * from './events';
export * from './agents';
export * from './domain';
export * from './emit';
