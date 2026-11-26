// Every tool a workspace can connect. No AI-model, speech or voice companies:
// which ones we use is ours to choose and never shown.

export type IntegrationCategory = "crm" | "calendar" | "data" | "messaging" | "automation";

export interface IntegrationInfo {
  id: string;
  name: string;
  domain?: string; // for the logo; absent = drawn icon
  logo?: string; // a direct icon when the domain's favicon is generic (Google apps all show the "G")
  category: IntegrationCategory;
  blurb: string; // one line: what an agent can do with it
  does: string[]; // the connect drawer's list
  syncsContacts?: boolean; // can be a contacts source
}

export const CATEGORIES: { id: IntegrationCategory; label: string }[] = [
  { id: "crm", label: "CRM" },
  { id: "calendar", label: "Calendars" },
  { id: "data", label: "Sheets & data" },
  { id: "messaging", label: "Messaging" },
  { id: "automation", label: "Automation" },
];

const CRM_DOES = ["Pull contacts and their fields into Contacts, kept in sync", "Start calls when new records arrive", "Write what a call collected back to the record", "Log every call with its summary and outcome"];

export const INTEGRATIONS: IntegrationInfo[] = [
  { id: "hubspot", name: "HubSpot", domain: "hubspot.com", category: "crm", blurb: "Sync contacts and deals, log calls, update properties.", does: CRM_DOES, syncsContacts: true },
  { id: "gohighlevel", name: "GoHighLevel", domain: "gohighlevel.com", category: "crm", blurb: "Sync contacts and pipelines, book on GHL calendars.", does: [...CRM_DOES, "Book on GHL calendars"], syncsContacts: true },
  { id: "salesforce", name: "Salesforce", domain: "salesforce.com", category: "crm", blurb: "Leads, contacts and opportunities, both ways.", does: CRM_DOES, syncsContacts: true },
  { id: "pipedrive", name: "Pipedrive", domain: "pipedrive.com", category: "crm", blurb: "People and deals, with call notes on each.", does: CRM_DOES, syncsContacts: true },
  { id: "zoho", name: "Zoho CRM", domain: "zoho.com", category: "crm", blurb: "Leads and contacts, with every call logged.", does: CRM_DOES, syncsContacts: true },
  { id: "twenty", name: "Twenty", domain: "twenty.com", category: "crm", blurb: "Open-source CRM: people, companies and notes.", does: CRM_DOES, syncsContacts: true },
  { id: "close", name: "Close", domain: "close.com", category: "crm", blurb: "Leads and opportunities for sales teams.", does: CRM_DOES, syncsContacts: true },
  { id: "attio", name: "Attio", domain: "attio.com", category: "crm", blurb: "Records and lists, updated after every call.", does: CRM_DOES, syncsContacts: true },
  { id: "monday", name: "monday CRM", domain: "monday.com", category: "crm", blurb: "Boards of contacts and deals.", does: CRM_DOES, syncsContacts: true },

  { id: "google_calendar", name: "Google Calendar", domain: "calendar.google.com", logo: "https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png", category: "calendar", blurb: "Check free times and book appointments.", does: ["See when you're free", "Book, move and cancel events", "Send invites to the caller"] },
  { id: "outlook", name: "Outlook Calendar", domain: "outlook.com", category: "calendar", blurb: "Book into Microsoft 365 calendars.", does: ["See when you're free", "Book, move and cancel events"] },
  { id: "calcom", name: "Cal.com", domain: "cal.com", category: "calendar", blurb: "Book into your event types and availability.", does: ["Offer times from your event types", "Book and reschedule"] },
  { id: "calendly", name: "Calendly", domain: "calendly.com", category: "calendar", blurb: "Offer your Calendly slots on the call.", does: ["Offer times from your event types", "Book on the call"] },

  { id: "google_sheets", name: "Google Sheets", domain: "sheets.google.com", logo: "https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico", category: "data", blurb: "Use a sheet as a contact list, write results back.", does: ["Use a sheet as a contacts source", "Add a row for every call", "Start calls when new rows appear"], syncsContacts: true },
  { id: "airtable", name: "Airtable", domain: "airtable.com", category: "data", blurb: "Bases as contact lists, results as new fields.", does: ["Use a table as a contacts source", "Update records after each call"], syncsContacts: true },

  { id: "slack", name: "Slack", domain: "slack.com", category: "messaging", blurb: "Post a message for bookings, hot leads or problems.", does: ["Post call summaries to a channel", "Alert someone when a call needs a person"] },
  { id: "teams", name: "Microsoft Teams", domain: "teams.microsoft.com", category: "messaging", blurb: "Call summaries and alerts in a Teams channel.", does: ["Post call summaries", "Alert when a call needs a person"] },
  { id: "gmail", name: "Gmail", domain: "mail.google.com", logo: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico", category: "messaging", blurb: "Email follow-ups from your own address.", does: ["Send follow-up emails after calls", "Email summaries to your team"] },

  { id: "zapier", name: "Zapier", domain: "zapier.com", category: "automation", blurb: "Send call results to 6,000+ apps.", does: ["Trigger a Zap for every finished call", "Start calls from any Zap"] },
  { id: "make", name: "Make", domain: "make.com", category: "automation", blurb: "Scenarios that start calls or use their results.", does: ["Send call results to a scenario", "Start calls from a scenario"] },
  { id: "n8n", name: "n8n", domain: "n8n.io", category: "automation", blurb: "Self-hosted workflows with call results.", does: ["Send call results to a workflow", "Start calls from a workflow"] },
  { id: "webhook", name: "Webhook", category: "automation", blurb: "Post each call's answers to your own URL.", does: ["POST the call's data as JSON when it ends", "Retry if your server is down"] },
];

export function integrationInfo(id: string): IntegrationInfo | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function logoUrl(info: IntegrationInfo): string | null {
  if (info.logo) return info.logo;
  return info.domain ? `https://www.google.com/s2/favicons?domain=${info.domain}&sz=64` : null;
}
