/**
 * Domain Library data access.
 *
 * Every call goes through the admin-gated `domainLibrary` task in
 * functions/index.js, which does the Firestore work with the Admin SDK and
 * re-verifies the caller's email server-side. Nothing here is seeded or
 * mocked — the client never touches these collections directly, because
 * firestore.rules denies that path outright.
 */

import { agentProxy } from './claude.js';

const call = (action, payload = {}) => agentProxy('domainLibrary', { action, payload });

export const domainLibraryApi = {
  async getStats() {
    return call('stats');
  },

  async getDomains() {
    const { domains } = await call('listDomains');
    return domains;
  },

  async createDomain({ name, description = '', icon = '📁', status = 'draft' }) {
    const { domain } = await call('createDomain', { name, description, icon, status });
    return domain;
  },

  async updateDomain(id, patch) {
    const { domain } = await call('updateDomain', { id, patch });
    return domain;
  },

  async deleteDomain(id) {
    return call('deleteDomain', { id });
  },

  async getSubDomains(domainId) {
    const { subDomains } = await call('listSubDomains', { domainId });
    return subDomains;
  },

  async createSubDomain({ domainId, name, description, status = 'draft' }) {
    const { subDomain } = await call('createSubDomain', { domainId, name, description, status });
    return subDomain;
  },

  async updateSubDomain(domainId, id, patch) {
    const { subDomain } = await call('updateSubDomain', { domainId, id, patch });
    return subDomain;
  },

  async deleteSubDomains(domainId, ids) {
    return call('deleteSubDomains', { domainId, ids });
  },

  async bulkUpdateSubDomains(domainId, ids, patch) {
    return call('bulkUpdateSubDomains', { domainId, ids, patch });
  },

  async getSkills(domainId) {
    const { skills } = await call('listSkills', { domainId });
    return skills;
  },

  async addSkills(domainId, names, meta) {
    const { skills } = await call('addSkills', { domainId, names, meta });
    return skills;
  },

  async updateSkill(domainId, id, patch) {
    const { skill } = await call('updateSkill', { domainId, id, patch });
    return skill;
  },

  async bulkUpdateSkills(domainId, ids, patch) {
    return call('bulkUpdateSkills', { domainId, ids, patch });
  },

  async deleteSkills(domainId, ids) {
    return call('deleteSkills', { domainId, ids });
  },

  async getBulletPoints(domainId) {
    const { bulletPoints } = await call('listBulletPoints', { domainId });
    return bulletPoints;
  },

  async saveBulletPoint(domainId, bulletPoint) {
    const res = await call('saveBulletPoint', { domainId, bulletPoint });
    return res.bulletPoint;
  },

  async deleteBulletPoint(domainId, id) {
    return call('deleteBulletPoint', { domainId, id });
  },

  async getInstructions(domainId) {
    const { instructions } = await call('listInstructions', { domainId });
    return instructions;
  },

  async saveInstruction(domainId, instruction) {
    const res = await call('saveInstruction', { domainId, instruction });
    return res.instruction;
  },

  async reorderInstructions(domainId, orderedIds) {
    return call('reorderInstructions', { domainId, orderedIds });
  },

  async deleteInstruction(domainId, id) {
    return call('deleteInstruction', { domainId, id });
  },

  // Resolves to { available: false, ... } until an analytics pipeline exists.
  async getUsage(domainId) {
    return call('usage', { domainId });
  },
};

/* ============ Publish validation — shared by dialog + toggle ============ */
export function validateDomainForPublish(domain, { subDomains: subs = [], skills: sk = [], instructions: ins = [] }) {
  const checks = [
    { id: 'description', label: 'Has a description', pass: Boolean(domain?.description?.trim()), tab: 'overview' },
    { id: 'subdomain', label: 'At least 1 sub-domain', pass: subs.length >= 1, tab: 'sub-domains' },
    { id: 'skills', label: 'At least 3 skills', pass: sk.length >= 3, tab: 'skills' },
    { id: 'instruction', label: 'At least 1 agent instruction', pass: ins.length >= 1, tab: 'instructions' },
  ];
  return { checks, ok: checks.every(c => c.pass) };
}
