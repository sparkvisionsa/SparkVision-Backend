import { ObjectId } from "mongodb";

export const TRANSACTIONS_COLLECTION = "transactions";

export type SavedFieldEntry = {
  label: string; // snapshotted Arabic/English label from template
  value: string; // what the user typed/selected
};

// ─── Available Services sub-document ─────────────────────────────────────────

export type AvailableServices = {
  electricity: boolean | null;
  electricityUnits: number | null;
  sanitaryDrainage: boolean | null;
  telephoneLine: boolean | null;
  waterMetersCount: number | null;
  electricityMetersCount: number | null;
};

export function emptyAvailableServices(): AvailableServices {
  return {
    electricity: null,
    electricityUnits: null,
    sanitaryDrainage: null,
    telephoneLine: null,
    waterMetersCount: null,
    electricityMetersCount: null,
  };
}

// All fields that the valuation page can fill in after the transaction is created.
// Kept in a dedicated sub-document so templateFieldValues is never mutated.
export type EvalData = {
  status: string; // "new" | "inspection" | "review" | "audit" | "approved" | "sent" | "cancelled" | "pending"

  // location & classification
  regionId: string;
  regionName: string;
  cityId: string;
  cityName: string;
  neighborhoodId: string;
  opponentStatements: string;
  neighborhoodName: string;
  assetCategoryId: string;
  propertyTypeId: string;

  address: string;
  inspector: string;
  contactNo: string;
  reviewer: string;

  landTitle: string;
  landSpace: string;

  // basic property data
  propertyCode: string;
  deedNumber: string;
  deedDate: string;
  ownerName: string;
  clientName: string;
  authorizedName: string;
  authorizedLandCoverPct: string;
  streetWidth: string;
  streetFronts: string;
  propertyType: string;
  landUse: string;

  // boundaries
  northBoundary: string;
  northLength: string;
  southBoundary: string;
  southLength: string;
  eastBoundary: string;
  eastLength: string;
  westBoundary: string;
  westLength: string;

  // finishing
  buildingCondition: {
    status: string;
    completionPct: number | null;
    otherText: string;
  };
  floorsCount: string;
  propertyAge: string;
  finishLevel: string;
  buildQuality: string;

  // services — replaces flat `street` field
  street: string; // kept for legacy reads; new UI uses availableServices
  availableServices: AvailableServices;
  surroundingEnvironment: string[];

  // map
  coords: string;
  lat: string;
  lng: string;
  zoomMap: string;
  zoomAerial: string;
  zoomComparisons: string;

  // appraiser opinion
  evalDate: string;
  completedDate: string;
  reportDate: string;
  finalAssetValue: string;
  appraiserDesc: string;
  appraiserNotes: string;

  // valuation methods — market
  marketMeterPrice: string;
  marketWeightPct: string;
  marketMethodTotal: string;
  marketReason: string;
  propertyArea: string;
  propertyAreaMethod: string;

  // valuation methods — cost
  costNetBuildings: string;
  costNetLandPrice: string;
  costLandBuildTotal: string;
  costReason: string;

  // valuation methods — income
  incomeTotal: string;
  incomeReason: string;

  // report items
  standards: string;
  scope: string;
  assumptions: string;
  risks: string;

  // report authors
  author1Id: string;
  author1Title: string;
  author2Id: string;
  author2Title: string;
  author3Id: string;
  author3Title: string;
  author4Id: string;
  author4Title: string;

  // comparison & settlement tables
  comparisonRows: any[];
  section1Rows: any[];
  settlementRows: any[];
  settlementBases: string[];
  settlementWeights: string[];

  // replacement cost
  replacementLines: any[];
  meterPriceLand: string;
  managementPct: string;
  professionalPct: string;
  utilityNetworkPct: string;
  emergencyPct: string;
  financePct: string;
  yearDev: string;
  earningsRate: string;
  buildAge: string;
  defaultAge: string;
  depreciationPct: string;
  economicPct: string;
  careerPct: string;
  maintenancePrice: string;
  finishesPrice: string;
  maintenanceDesc: string;
  finishesDesc: string;
  replacementNotes: string;
  investmentEntries: any[];
  residualValueEntries: any[];
  dcfEntries: any[];
  rentalValueEntries: any[];

  subDivisionRecordNumber: string;
  otherUsers: string;
  deedSource: string;
  buildingLicense: string;
  buildingLicenseDate: string;
  elevation: string;
  inspectionBoundaries: string;
  completionPct: string;

  previousDeedNumber: string;
  previousDeedDate: string;
  operationType: string;
  propertyStatus: string;
  restrictions: string;
  ownerId: string;
  ownerNationality: string;
  ownershipPercentage: string;
  propertyId: string;
  parcelNumber: string;
  blockNumber: string;
  districtPart: string;
  propertyModel: string;
  locationDescription: string;
  planNumber: string;
};

export function emptyEvalData(): EvalData {
  return {
    status: "new",
    regionId: "",
    regionName: "",
    cityId: "",
    cityName: "",
    neighborhoodId: "",
    neighborhoodName: "",
    assetCategoryId: "",
    opponentStatements: "",
    propertyTypeId: "",
    propertyCode: "",
    deedNumber: "",
    deedDate: "",
    address: "",
    inspector: "",
    contactNo: "",
    reviewer: "",
    landTitle: "",
    landSpace: "",
    ownerName: "",
    propertyType: "",
    landUse: "",
    clientName: "",
    authorizedName: "",
    authorizedLandCoverPct: "",
    streetWidth: "",
    streetFronts: "",
    northBoundary: "",
    northLength: "",
    southBoundary: "",
    southLength: "",
    eastBoundary: "",
    eastLength: "",
    westBoundary: "",
    westLength: "",
    buildingCondition: {
      status: "",
      completionPct: null,
      otherText: "",
    },
    floorsCount: "",
    propertyAge: "",
    finishLevel: "",
    buildQuality: "",
    street: "",
    availableServices: emptyAvailableServices(),
    surroundingEnvironment: [],
    coords: "",
    lat: "",
    lng: "",
    zoomMap: "",
    zoomAerial: "",
    zoomComparisons: "",
    evalDate: "",
    completedDate: "",
    reportDate: "",
    finalAssetValue: "",
    appraiserDesc: "",
    appraiserNotes: "",
    marketMeterPrice: "",
    marketWeightPct: "",
    marketMethodTotal: "",
    marketReason: "",
    propertyAreaMethod: "",
    propertyArea: "",
    costNetBuildings: "",
    costNetLandPrice: "",
    costLandBuildTotal: "",
    costReason: "",
    incomeTotal: "",
    incomeReason: "",
    standards: "",
    scope: "",
    assumptions: "",
    risks: "",
    author1Id: "",
    author1Title: "",
    author2Id: "",
    author2Title: "",
    author3Id: "",
    author3Title: "",
    author4Id: "",
    author4Title: "",
    comparisonRows: [],
    section1Rows: [],
    settlementRows: [],
    settlementBases: [],
    settlementWeights: [],
    replacementLines: [],
    meterPriceLand: "",
    managementPct: "",
    professionalPct: "",
    utilityNetworkPct: "",
    emergencyPct: "",
    financePct: "",
    yearDev: "",
    earningsRate: "",
    buildAge: "",
    defaultAge: "",
    depreciationPct: "",
    economicPct: "",
    careerPct: "",
    maintenancePrice: "",
    finishesPrice: "",
    maintenanceDesc: "",
    finishesDesc: "",
    replacementNotes: "",
    investmentEntries: [],
    residualValueEntries: [],
    dcfEntries: [],
    rentalValueEntries: [],
    completionPct: "",
    subDivisionRecordNumber: "",
    otherUsers: "",
    deedSource: "",
    buildingLicense: "",
    buildingLicenseDate: "",
    elevation: "",
    inspectionBoundaries: "",
    previousDeedNumber: "",
    previousDeedDate: "",
    operationType: "",
    propertyStatus: "",
    restrictions: "",
    ownerId: "",
    ownerNationality: "",
    ownershipPercentage: "",
    propertyId: "",
    parcelNumber: "",
    blockNumber: "",
    districtPart: "",
    propertyModel: "",
    locationDescription: "",
    planNumber: "",
  };
}

export type TransactionDoc = {
  _id: ObjectId;

  // core assignment fields — set on creation, not touched by the eval page
  assignmentNumber: string;
  authorizationNumber: string;
  /** IDs of inspector users assigned to this transaction */
  assignedInspectorIds?: string[];
  createdByUserId?: string | null;
  companyId?: string | null;
  assignmentDate: string;
  valuationPurpose: string;
  intendedUse: string;
  valuationBasis: string;
  priority: string; // "normal" | "urgent"  (default "normal")
  attachmentsCount: number; // default 0
  imagesCount: number; // default 0
  ownershipType: string;
  valuationHypothesis: string;
  clientId: string;
  branch: string;
  templateId: string | null;

  // dynamic template fields — NEVER mutated after creation
  templateFieldValues: Record<string, SavedFieldEntry>;

  // all valuation-page fields live here, initialised to empty on creation
  evalData: EvalData;

  createdAt: Date;
  updatedAt: Date;

  isOpened?: boolean;
  isCompleted?: boolean;
};
