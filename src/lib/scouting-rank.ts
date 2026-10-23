export type ScoutingJobInput = {
  title: string;
  url: string;
  location?: string;
  postedAt?: string;
};

export type ScoutingCompanyInput = {
  name: string;
  domain?: string;
  website?: string;
  stage: string;
  employeeCount: number;
  location: string;
  workMode: "remote" | "distributed";
  businessType: "product_company" | "hr_tech" | "recruiting_staffing" | "agency" | "outsourcing";
  industry?: string;
  description?: string;
  jobs: ScoutingJobInput[];
};

export type RankedScoutingJob = ScoutingJobInput & {
  category: "engineering" | "data" | "product" | "marketing";
  daysOpen?: number;
  staleSeniorEngineering: boolean;
};

export type RankedScoutingCompany = Omit<ScoutingCompanyInput, "jobs" | "stage"> & {
  stage: string;
  geographyRank: number;
  geographyLabel: string;
  jobs: RankedScoutingJob[];
  engineeringRoleCount: number;
  staleSeniorEngineeringRole: boolean;
  staleSeniorRoleDays?: number;
  signalRank: number;
  rankingReason: string;
};

const REGIONS = [
  {
    label: "United States",
    pattern:
      /\b(united states|u\.s\.a?\.?|america|california|new york|texas|washington|massachusetts|florida|illinois|colorado|georgia|north carolina|virginia|san francisco|los angeles|new york city|seattle|boston|austin|chicago|denver|miami|atlanta)\b/i,
  },
  {
    label: "Europe",
    pattern:
      /\b(europe|united kingdom|uk|ireland|france|germany|spain|portugal|italy|netherlands|belgium|switzerland|sweden|norway|denmark|finland|poland|austria|greece|czechia|romania|estonia|lithuania|latvia|london|paris|berlin|amsterdam|dublin|stockholm|lisbon|madrid|barcelona|rome|zurich|helsinki|copenhagen|warsaw)\b/i,
  },
  {
    label: "Africa",
    pattern:
      /\b(africa|nigeria|ghana|kenya|south africa|egypt|morocco|rwanda|senegal|uganda|ethiopia|tanzania|ivory coast|côte d'ivoire|lagos|accra|nairobi|cape town|johannesburg|cairo|casablanca|kigali|kampala|addis ababa|dar es salaam)\b/i,
  },
  {
    label: "Latin America",
    pattern:
      /\b(latin america|latam|brazil|mexico|argentina|colombia|chile|peru|uruguay|costa rica|panama|ecuador|sao paulo|são paulo|mexico city|buenos aires|bogota|bogotá|santiago|lima|montevideo|san jose|quito)\b/i,
  },
] as const;

function normalizeStage(stage: string): string | undefined {
  const normalized = stage.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (/^seed\b/.test(normalized)) return "Seed";
  if (/^series\s*a\b/.test(normalized)) return "Series A";
  if (/^series\s*b\b/.test(normalized)) return "Series B";
  return undefined;
}

function geography(location: string) {
  const index = REGIONS.findIndex((region) => region.pattern.test(location));
  return index < 0 ? undefined : { rank: index, label: REGIONS[index].label };
}

function classifyRole(title: string): RankedScoutingJob["category"] | undefined {
  if (/\b(design|designer|analyst|sales|account executive|sdr|bdr)\b/i.test(title)) {
    return undefined;
  }
  if (/\b(junior|entry[ -]level|graduate|intern(ship)?)\b/i.test(title)) {
    return undefined;
  }
  if (
    /\b(engineer(ing)?|software|developer|devops|sre|site reliability|platform|backend|back[ -]end|front[ -]end|frontend|full[ -]stack|mobile|firmware|embedded|mlops)\b/i.test(
      title,
    )
  ) {
    return "engineering";
  }
  if (
    /\b(machine learning|artificial intelligence|ai researcher|ml researcher|data scientist|data science|applied scientist)\b/i.test(
      title,
    )
  ) {
    return "data";
  }
  if (
    /\b(product manager|product lead|product owner|chief product officer|vp product)\b/i.test(title)
  ) {
    return "product";
  }
  if (/\b(marketing|growth|demand generation|content|seo|performance)\b/i.test(title)) {
    return "marketing";
  }
  return undefined;
}

function daysSince(postedAt?: string): number | undefined {
  if (!postedAt) return undefined;
  const time = Date.parse(postedAt);
  if (!Number.isFinite(time)) return undefined;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function isSeniorEngineeringTitle(title: string) {
  return /\b(founding|senior|staff|principal|lead|distinguished)\b/i.test(title);
}

function isExcludedBusiness(company: ScoutingCompanyInput) {
  if (company.businessType !== "product_company") return true;
  return /\b(hr tech|human resources technology|recruiting|recruitment|staffing|talent agency|outsourcing)\b/i.test(
    `${company.industry ?? ""} ${company.description ?? ""}`,
  );
}

export function rankScoutingCompanies(companies: ScoutingCompanyInput[]): RankedScoutingCompany[] {
  const ranked = companies.flatMap((company) => {
    const stage = normalizeStage(company.stage);
    const region = geography(company.location);
    if (
      !stage ||
      !region ||
      (company.workMode !== "remote" && company.workMode !== "distributed") ||
      isExcludedBusiness(company) ||
      !Number.isInteger(company.employeeCount) ||
      company.employeeCount < 15 ||
      company.employeeCount > 80
    ) {
      return [];
    }

    const jobs = company.jobs.flatMap((job) => {
      const category = classifyRole(job.title);
      if (!category || !job.url) return [];
      const age = daysSince(job.postedAt);
      return [
        {
          ...job,
          category,
          ...(age === undefined ? {} : { daysOpen: age }),
          staleSeniorEngineering:
            category === "engineering" &&
            isSeniorEngineeringTitle(job.title) &&
            age !== undefined &&
            age > 14,
        },
      ];
    });
    if (jobs.length === 0) return [];

    const engineeringRoleCount = jobs.filter((job) => job.category === "engineering").length;
    const staleSeniorRole = jobs
      .filter((job) => job.staleSeniorEngineering)
      .sort((a, b) => (b.daysOpen ?? 0) - (a.daysOpen ?? 0))[0];
    const signalRank = engineeringRoleCount >= 3 ? 1 : staleSeniorRole ? 2 : 3;
    const rankingReason =
      signalRank === 1
        ? `${engineeringRoleCount} eligible engineering roles are open.`
        : signalRank === 2
          ? `${staleSeniorRole.title} has been listed for ${staleSeniorRole.daysOpen} days.`
          : `${jobs.length} eligible live role${jobs.length === 1 ? "" : "s"}; no higher-priority hiring signal was verified.`;

    return [
      {
        ...company,
        stage,
        geographyRank: region.rank,
        geographyLabel: region.label,
        jobs,
        engineeringRoleCount,
        staleSeniorEngineeringRole: Boolean(staleSeniorRole),
        ...(staleSeniorRole?.daysOpen === undefined
          ? {}
          : { staleSeniorRoleDays: staleSeniorRole.daysOpen }),
        signalRank,
        rankingReason,
      },
    ];
  });

  return ranked.sort(
    (a, b) =>
      a.signalRank - b.signalRank ||
      (a.signalRank === 1 ? b.engineeringRoleCount - a.engineeringRoleCount : 0) ||
      (a.signalRank === 2 ? (b.staleSeniorRoleDays ?? 0) - (a.staleSeniorRoleDays ?? 0) : 0) ||
      a.geographyRank - b.geographyRank ||
      a.name.localeCompare(b.name),
  );
}
