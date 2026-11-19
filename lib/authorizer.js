// Approval is a local, user-only act. A remote peer, an AI suggestion and a
// scheduler can never approve anything.

import { hash } from './protocol.js'
import { planContent } from './planner.js'

export function approvalKey(plan) {
  return hash(planContent(plan))
}

export function createApproval(plan, { actor, opIds, at }) {
  if (!['user', 'auto:managed'].includes(actor)) return { ok: false, reason: 'invalid-approval-actor' }
  if (!Array.isArray(opIds)) return { ok: false, reason: 'bad-operation-list' }
  const opIdSet = new Set(plan.operations.map((op) => op.opId))
  const unknown = (opIds ?? []).filter((opId) => !opIdSet.has(opId))
  if (unknown.length) return { ok: false, reason: 'unknown-operation', unknown }
  return {
    ok: true,
    approval: {
      planId: plan.planId,
      key: approvalKey(plan),
      actor,
      policyHash: plan.policyHash,
      opIds: [...new Set(opIds ?? [])].sort(),
      at,
      requiresExtraApproval: Boolean(plan.requiresExtraApproval),
    },
  }
}

export function verifyApproval(plan, approval, currentPolicyHash = plan.policyHash) {
  if (!approval) return { ok: false, reason: 'no-approval' }
  if (!['user', 'auto:managed'].includes(approval.actor)) return { ok: false, reason: 'invalid-approval-actor' }
  if (!plan.policyHash || approval.policyHash !== plan.policyHash || currentPolicyHash !== plan.policyHash) return { ok: false, reason: 'policy-changed' }
  if (approval.planId !== plan.planId) return { ok: false, reason: 'plan-changed' }
  if (approval.key !== approvalKey(plan)) return { ok: false, reason: 'plan-content-changed' }
  const allowed = new Set(approval.opIds)
  const authorized = plan.operations.filter((op) => allowed.has(op.opId)).map((op) => op.opId)
  if (!authorized.length) return { ok: false, reason: 'no-operation-approved' }
  if (plan.requiresExtraApproval && !approval.requiresExtraApproval) {
    return { ok: false, reason: 'batch-approval-missing' }
  }
  return { ok: true, authorized }
}
