import { z } from 'zod';

export const operationsReportQuery = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  warehouseId: z.string().optional()
});

export type OperationsReportQuery = z.infer<typeof operationsReportQuery>;

export interface OperationsReportData {
  generatedAt: string;
  company: {
    id: string;
    code: string;
    name: string;
  };
  warehouse: {
    id: string;
    code: string;
    name: string;
  };
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  inbound: {
    purchaseOrdersCount: number;
    totalExpectedUnits: string;
    receivedBoxesCount: number;
    discrepanciesCount: number;
    discrepancyBreakdown: {
      damaged: number;
      short: number;
      over: number;
      unexpected: number;
    };
  };
  picking: {
    totalPicksVerified: number;
    totalUnitsPicked: string;
    shortagePicksCount: number;
    substitutionsCount: number;
    totesDispatchedCount: number;
  };
  inventory: {
    totalOnHandQuantity: string;
    totalReservedQuantity: string;
    totalAvailableQuantity: string;
    totalHeldQuantity: string;
    stockOwners: Array<{
      ownerId: string;
      ownerName: string;
      onHand: string;
      available: string;
      held: string;
    }>;
  };
  quality: {
    activeHoldsCount: number;
    holdSeverityBreakdown: {
      critical: number;
      major: number;
      minor: number;
    };
    quarantinedLotsCount: number;
    quarantinedSerialsCount: number;
  };
  tasks: {
    openTasksCount: number;
    claimedTasksCount: number;
    blockedTasksCount: number;
    urgentPriorityCount: number;
  };
}
