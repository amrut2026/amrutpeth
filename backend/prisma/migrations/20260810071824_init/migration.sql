-- CreateTable
CREATE TABLE "Organisation" (
    "orgId" SERIAL NOT NULL,
    "orgName" TEXT NOT NULL,
    "orgAddress" TEXT NOT NULL,
    "orgContact" TEXT NOT NULL,
    "orgType" TEXT NOT NULL DEFAULT 'MAHAMANDAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "roleId" SERIAL NOT NULL,
    "roleName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("roleId")
);

-- CreateTable
CREATE TABLE "Activity" (
    "activityId" SERIAL NOT NULL,
    "activityName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("activityId")
);

-- CreateTable
CREATE TABLE "RoleActivityMapping" (
    "mappingId" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,
    "iactive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleActivityMapping_pkey" PRIMARY KEY ("mappingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_roleName_key" ON "UserRole"("roleName");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_activityName_key" ON "Activity"("activityName");

-- CreateIndex
CREATE UNIQUE INDEX "RoleActivityMapping_roleId_activityId_key" ON "RoleActivityMapping"("roleId", "activityId");

-- AddForeignKey
ALTER TABLE "RoleActivityMapping" ADD CONSTRAINT "RoleActivityMapping_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "UserRole"("roleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleActivityMapping" ADD CONSTRAINT "RoleActivityMapping_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("activityId") ON DELETE RESTRICT ON UPDATE CASCADE;
