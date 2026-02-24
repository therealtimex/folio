import { WizardAction, WizardState } from "./types";

const MAX_LOGS = 500;

export const initialState: WizardState = {
  step: "welcome",
  managed: {
    accessToken: "",
    organizations: [],
    selectedOrg: "",
    projectName: "Folio-Core",
    region: "us-east-1",
    isFetchingOrgs: false
  },
  manual: {
    url: "",
    anonKey: ""
  },
  projectId: "",
  logs: [],
  error: null,
  isMigrating: false,
  migrationStatus: null
};

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return {
        ...state,
        step: action.payload,
        error: null
      };

    case "SET_ACCESS_TOKEN":
      return {
        ...state,
        managed: {
          ...state.managed,
          accessToken: action.payload
        }
      };

    case "SET_ORGANIZATIONS":
      return {
        ...state,
        managed: {
          ...state.managed,
          organizations: action.payload,
          selectedOrg: action.payload.length > 0 ? action.payload[0].id : ""
        }
      };

    case "SET_SELECTED_ORG":
      return {
        ...state,
        managed: {
          ...state.managed,
          selectedOrg: action.payload
        }
      };

    case "SET_PROJECT_NAME":
      return {
        ...state,
        managed: {
          ...state.managed,
          projectName: action.payload
        }
      };

    case "SET_REGION":
      return {
        ...state,
        managed: {
          ...state.managed,
          region: action.payload
        }
      };

    case "SET_FETCHING_ORGS":
      return {
        ...state,
        managed: {
          ...state.managed,
          isFetchingOrgs: action.payload
        }
      };

    case "SET_MANUAL_URL":
      return {
        ...state,
        manual: {
          ...state.manual,
          url: action.payload
        }
      };

    case "SET_MANUAL_ANON_KEY":
      return {
        ...state,
        manual: {
          ...state.manual,
          anonKey: action.payload
        }
      };

    case "SET_PROJECT_ID":
      return {
        ...state,
        projectId: action.payload
      };

    case "ADD_LOG":
      return {
        ...state,
        logs: [
          ...state.logs,
          {
            ...action.payload,
            timestamp: Date.now()
          }
        ].slice(-MAX_LOGS)
      };

    case "CLEAR_LOGS":
      return {
        ...state,
        logs: []
      };

    case "SET_ERROR":
      return {
        ...state,
        error: action.payload
      };

    case "SET_MIGRATING":
      return {
        ...state,
        isMigrating: action.payload
      };

    case "SET_MIGRATION_STATUS":
      return {
        ...state,
        migrationStatus: action.payload
      };

    case "RESET_MANAGED_FLOW":
      return {
        ...state,
        managed: {
          ...initialState.managed
        },
        error: null
      };

    case "RESET_MANUAL_FLOW":
      return {
        ...state,
        manual: {
          ...initialState.manual
        },
        error: null
      };

    default:
      return state;
  }
}
