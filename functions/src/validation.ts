import { z } from "zod";

// Mirrors backend/src/validators.ts so the Functions API enforces identical rules.
// (Kept as a copy: functions/ deploys standalone to Firebase; backend/ stays
// frozen as the legacy local stack + migration source.)

export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(8).max(128);

export const bootstrapSchema = z.object({
  name: z.string().min(2).max(80),
  email: emailSchema,
  password: passwordSchema,
});

export const createUserSchema = z.object({
  name: z.string().min(2).max(80),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export const projectCategories = [
  "Website Development",
  "E-commerce Development",
  "Website Maintenance",
  "Website Bug Fixes",
  "UI/UX Design",
  "SEO",
  "Social Media Marketing",
  "Google Ads",
  "Meta Ads",
  "Content Creation",
  "Branding and Graphic Design",
  "Email Marketing",
  "Automation",
  "Other",
] as const;

export const projectSchema = z.object({
  name: z.string().min(2).max(120),
  clientName: z.string().max(120).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  category: z.string().min(2).max(60),
  status: z
    .enum(["PLANNING", "NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "IN_REVIEW", "COMPLETED", "CANCELLED"])
    .default("PLANNING"),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  startDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  ownerId: z.string().min(1),
  memberIds: z.array(z.string()).default([]),
  tags: z.array(z.string().max(30)).max(20).default([]),
  links: z.record(z.string()).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const taskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(2).max(200),
  description: z.string().max(8000).optional().nullable(),
  status: z
    .enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED", "CANCELLED"])
    .default("NOT_STARTED"),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  assigneeId: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  labels: z.array(z.string().max(30)).max(20).default([]),
});

export const taskUpdateSchema = taskSchema.partial().omit({ projectId: true });

export const subtaskSchema = z.object({
  title: z.string().min(1).max(200),
  done: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

export const bugSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(2).max(200),
  websiteUrl: z.string().url().max(500).optional().nullable().or(z.literal("")),
  description: z.string().min(5).max(8000),
  steps: z.string().max(8000).optional().nullable(),
  expected: z.string().max(4000).optional().nullable(),
  actual: z.string().max(4000).optional().nullable(),
  pageRoute: z.string().max(500).optional().nullable(),
  device: z.string().max(120).optional().nullable(),
  viewport: z.enum(["MOBILE", "TABLET", "DESKTOP"]).optional().nullable(),
  severity: z.enum(["CRITICAL", "MAJOR", "MODERATE", "MINOR"]).default("MODERATE"),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  assigneeId: z.string().optional().nullable(),
  targetFixDate: z.string().datetime().optional().nullable(),
});

export const bugUpdateSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  websiteUrl: z.string().max(500).optional().nullable(),
  description: z.string().min(5).max(8000).optional(),
  steps: z.string().max(8000).optional().nullable(),
  expected: z.string().max(4000).optional().nullable(),
  actual: z.string().max(4000).optional().nullable(),
  pageRoute: z.string().max(500).optional().nullable(),
  device: z.string().max(120).optional().nullable(),
  viewport: z.enum(["MOBILE", "TABLET", "DESKTOP"]).optional().nullable(),
  severity: z.enum(["CRITICAL", "MAJOR", "MODERATE", "MINOR"]).optional(),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).optional(),
  assigneeId: z.string().optional().nullable(),
  status: z
    .enum([
      "REPORTED",
      "CONFIRMED",
      "NOT_STARTED",
      "IN_PROGRESS",
      "BLOCKED",
      "FIXED",
      "READY_FOR_TESTING",
      "VERIFIED",
      "REOPENED",
      "CLOSED",
    ])
    .optional(),
  targetFixDate: z.string().datetime().optional().nullable(),
  resolutionNotes: z.string().max(8000).optional().nullable(),
});

export const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  projectId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  bugId: z.string().optional().nullable(),
});
