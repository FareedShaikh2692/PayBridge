import { bootstrapReferenceData, createPrismaClient } from './index';

async function main() {
  const prisma = createPrismaClient();
  await bootstrapReferenceData(prisma);
  await prisma.$disconnect();
  console.log('Reference data installed.');
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
