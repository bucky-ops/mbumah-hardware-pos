---
name: Feature Request
about: Suggest a new feature or enhancement for MBUMAH HARDWARE POS
title: '[FEATURE] '
labels: enhancement, needs-triage
assignees: ''
---

## Problem Statement

A clear and concise description of what problem this feature would solve. Example: "I'm always frustrated when [...]"

## Proposed Solution

A clear and concise description of what you want to happen.

## Alternatives Considered

A clear and concise description of any alternative solutions or features you've considered.

## Detailed Design

### User Flow

Describe the expected user interaction step by step:

1. User navigates to...
2. User clicks on...
3. System responds with...

### API Changes

If this feature requires new or modified API endpoints, describe them here:

- `GET /api/...` - Description
- `POST /api/...` - Description

### Database Changes

If this feature requires schema changes, describe them here:

```prisma
model Example {
  id    String @id @default(cuid())
  // Add proposed fields
}
```

### UI Components

List any new UI components or modifications needed:

- [ ] Component A
- [ ] Component B

## Business Impact

- **Affected roles**: [e.g. Cashier, Admin, Accountant]
- **Store operations impact**: [e.g. Faster checkout, Better inventory tracking]
- **Priority level**: [e.g. Low, Medium, High, Critical]

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Additional Context

Add any other context, mockups, or screenshots about the feature request here.

## Kenya-Specific Considerations

Does this feature involve any Kenya-specific requirements?

- [ ] KRA compliance (e-invoicing, tax reporting)
- [ ] M-Pesa integration changes
- [ ] KES currency handling
- [ ] Kenyan business regulations
