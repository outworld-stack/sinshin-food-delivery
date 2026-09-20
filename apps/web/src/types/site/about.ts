// src/types/site/about.ts
// فیلدهای قابل ویرایش صفحه درباره ما
export interface AboutContentInput {
  heroTitle: string
  heroText: string
  heroGradient: string
  teamTitle: string
  teamGradient: string
  teamAlt: string
}

export interface AboutContent extends AboutContentInput {
  updatedAt: Date
}