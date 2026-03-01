/**
 * Board onboarding types for guided setup wizard state.
 *
 * Based on BoardOnboardingSession model and board_onboarding Pydantic schemas.
 */

// ---------------------------------------------------------------------------
// Status and step types
// ---------------------------------------------------------------------------

/** Current status of a board onboarding session. */
export type OnboardingStatus = 'active' | 'complete' | 'abandoned' | (string & {});

/** Individual step within the onboarding wizard. */
export interface OnboardingStep {
  id: string;
  label: string;
  completed: boolean;
  current?: boolean;
}

// ---------------------------------------------------------------------------
// Lead-agent configuration
// ---------------------------------------------------------------------------

export type LeadAgentAutonomyLevel = 'ask_first' | 'balanced' | 'autonomous';
export type LeadAgentVerbosity = 'concise' | 'balanced' | 'detailed';
export type LeadAgentOutputFormat = 'bullets' | 'mixed' | 'narrative';
export type LeadAgentUpdateCadence = 'asap' | 'hourly' | 'daily' | 'weekly';

/** Editable lead-agent draft configuration collected during onboarding. */
export interface OnboardingLeadAgentDraft {
  name?: string | null;
  identityProfile?: Record<string, string> | null;
  autonomyLevel?: LeadAgentAutonomyLevel | null;
  verbosity?: LeadAgentVerbosity | null;
  outputFormat?: LeadAgentOutputFormat | null;
  updateCadence?: LeadAgentUpdateCadence | null;
  customInstructions?: string | null;
}

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

/** User-profile preferences gathered during onboarding. */
export interface OnboardingUserProfile {
  preferredName?: string | null;
  pronouns?: string | null;
  timezone?: string | null;
  notes?: string | null;
  context?: string | null;
}

// ---------------------------------------------------------------------------
// Question / answer payloads
// ---------------------------------------------------------------------------

/** Selectable option for an onboarding question. */
export interface OnboardingQuestionOption {
  id: string;
  label: string;
}

/** Question payload emitted by the onboarding assistant. */
export interface OnboardingAgentQuestion {
  question: string;
  options: OnboardingQuestionOption[];
}

/** User answer payload for a single onboarding question. */
export interface OnboardingAnswer {
  answer: string;
  otherText?: string | null;
}

// ---------------------------------------------------------------------------
// Confirmation / completion
// ---------------------------------------------------------------------------

/** Payload used to confirm generated onboarding draft fields. */
export interface OnboardingConfirm {
  boardType: string;
  objective?: string | null;
  successMetrics?: Record<string, unknown> | null;
  targetDate?: string | null;
}

/** Complete onboarding draft produced by the onboarding assistant. */
export interface OnboardingAgentComplete extends OnboardingConfirm {
  status: 'complete';
  userProfile?: OnboardingUserProfile | null;
  leadAgent?: OnboardingLeadAgentDraft | null;
}

/** Union of agent update payloads during onboarding: a question or completion. */
export type OnboardingAgentUpdate = OnboardingAgentComplete | OnboardingAgentQuestion;

// ---------------------------------------------------------------------------
// Session read
// ---------------------------------------------------------------------------

/** Message entry stored within an onboarding session. */
export interface OnboardingMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

/** Stored onboarding session state returned by API endpoints. */
export interface BoardOnboardingSession {
  id: string;
  boardId: string;
  sessionKey: string;
  status: OnboardingStatus;
  messages: OnboardingMessage[] | null;
  draftGoal: OnboardingAgentComplete | null;
  createdAt: string;
  updatedAt: string;
}
