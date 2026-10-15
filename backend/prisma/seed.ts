import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth.js";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = process.env.ADMIN_NAME ?? "Ationic Admin";
  if (!email || !password) {
    console.log("Seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env to provision the first admin.");
    return;
  }
  let workspace = await prisma.workspace.findUnique({ where: { slug: "ationic" } });
  if (!workspace) workspace = await prisma.workspace.create({ data: { name: "Ationic", slug: "ationic" } });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { name, email, passwordHash, role: "ADMIN" } });
  await prisma.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "ADMIN" } });
  console.log(`Seeded admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
