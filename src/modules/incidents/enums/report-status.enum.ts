/** report_status. Paperwork review only; never touches incident state. */
export enum ReportStatusEnum {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  NEEDS_REVISION = 'needs_revision',
  APPROVED = 'approved',
}
