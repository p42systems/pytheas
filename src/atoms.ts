import makeMatcher from "wouter/matcher";
import { atom } from "jotai";
import { atomWithStorage, loadable } from "jotai/utils";
import { atomWithMachine } from "jotai/xstate";
import { atomWithQuery } from "jotai/query";
import { IconOptions, LatLngBounds } from "leaflet";
import type { useMap } from "react-leaflet";

import { viewControllerMachine } from "./machines/viewController";
import {
  fetchBoundingBox,
  fetchMarkerDetails,
  fetchMarkers,
  fetchRoute,
} from "./services";
import { IMarker, TourStates } from "./types";
import { FeatureCollection } from "geojson";

/*********************************
 * URL matcher
 *********************************/

// Makes it possible to set default state of an atom base on the url
const matcher = makeMatcher();
const [isDetailUrl, detailUrlParams] = matcher(
  "/tour/details/:id",
  location.pathname
);

function urlHasId(id: string | undefined): id is string {
  return id != null;
}

/*********************************
 * Marker Progress Atoms
 *********************************/

type MarkerProgress = Record<string, boolean>;

const markerProgress = atomWithStorage<MarkerProgress>("markerProgress", {});

export const toggleMarkerProgressAtom = atom(null, (_get, set, id: string) => {
  set(markerProgress, (state) => {
    if (id in state) {
      return {
        ...state,
        [id]: !state[id],
      };
    } else {
      return {
        ...state,
        [id]: true,
      };
    }
  });
});

export const getAllMarkerProgressAtom = atom((get) => get(markerProgress));

/*********************************
 * Icon Config Atoms
 *********************************/

interface IMapIcons {
  base: IconOptions;
  selected: IconOptions;
  completed: IconOptions;
  suggested: IconOptions;
}

export const iconsAtom = atom<IMapIcons>({
  base: {
    iconUrl: "/markers/base.svg",
    iconSize: [36, 50],
    iconAnchor: [18, 50],
  },
  selected: {
    iconUrl: "/markers/selected.svg",
    iconSize: [36, 50],
    iconAnchor: [18, 50],
  },
  completed: {
    iconUrl: "/markers/completed.svg",
    iconSize: [36, 50],
    iconAnchor: [18, 50],
  },
  suggested: {
    iconUrl: "/markers/suggested.svg",
    iconSize: [36, 50],
    iconAnchor: [18, 50],
  },
});

export const baseIconConfigAtom = atom((get) => get(iconsAtom).base);
export const selectedIconConfigAtom = atom((get) => get(iconsAtom).selected);
export const completedIconConfigAtom = atom((get) => get(iconsAtom).completed);
export const suggestedIconConfigAtom = atom((get) => get(iconsAtom).suggested);

/*********************************
 * Leaflet Map Ref Atom
 *********************************/

const mapAtom = atom<ReturnType<typeof useMap> | null | undefined>(undefined);
export const mapValueAtom = atom((get) => get(mapAtom));
export const setMapAtom = atom(
  null,
  (_get, set, value: ReturnType<typeof useMap> | null | undefined) =>
    set(mapAtom, value)
);

/*********************************
 * ORS Atoms
 *********************************/

export const ORSAPIKeyAtom = atom<string>("");
export const getORSAPIKeyAtom = atom((get) => get(ORSAPIKeyAtom));

export const ORSAPIEndpointAtom = atom<string>(
  "https://api.openrouteservice.org"
);
export const getORSAPIEndpointAtom = atom((get) => get(ORSAPIEndpointAtom));

/*********************************
 * Enable/Disable directions
 *********************************/

export const enableDirectionsAtom = atom<boolean>(true);
export const getEnableDirectionsAtom = atom((get) => get(enableDirectionsAtom));
export const disableDirectionsAtom = atom(null, (_get, set) =>
  set(enableDirectionsAtom, false)
);
export const toggleEnableDirectionsAtom = atom(null, (get, set) =>
  set(enableDirectionsAtom, !get(enableDirectionsAtom))
);

/*********************************
 * Main Tour State / Atoms
 *********************************/

export const viewControllerMachineAtom = atomWithMachine(() => {
  return viewControllerMachine.withContext({
    boundingBoxRef: null,
    userLocation: null,
    savedUserLocation: null,
    enableHighAccuracy: true,
  });
});

export const getViewControllerStateAtom = atom((get) => {
  const { value, matches } = get(viewControllerMachineAtom);
  return { value, matches };
});

export const getUserLocationAtom = atom(
  (get) => get(viewControllerMachineAtom).context.userLocation
);

export const getSavedUserLocationAtom = atom(
  (get) => get(viewControllerMachineAtom).context.savedUserLocation
);

export const sendSaveUserLocationAtom = atom(null, (_get, set) =>
  set(viewControllerMachineAtom, { type: "SAVE_USER_LOCATION" })
);

export const sendCheckBoundsAtom = atom(null, (_get, set) =>
  set(viewControllerMachineAtom, { type: "CHECK_BOUNDS" })
);

/*********************************
 * Selected Marker Atoms
 *********************************/

const selectedMarkerIdAtom = atom<string | null>(
  isDetailUrl && urlHasId(detailUrlParams.id) ? detailUrlParams.id : null
);

export const updateSelectedMarkerAtom = atom(
  null,
  (_get, set, value: string | null) => {
    set(selectedMarkerIdAtom, value);
  }
);

export const selectedMarkerAtom = atom<IMarker | null>((get) => {
  const { markers } = get(markersQueryAtom);
  const selectedMarkerId = get(selectedMarkerIdAtom);
  return selectedMarkerId != null
    ? selectedMarkerId in markers
      ? markers[selectedMarkerId]
      : null
    : null;
});

/*********************************
 * Suggested Marker Atoms
 *********************************/

export const suggestedMarkerAtom = atom<IMarker | null>((get) => {
  const { markers, order } = get(markersQueryAtom);
  const progress = get(getAllMarkerProgressAtom);
  const markersId = order
    // Do not suggest extra markers
    .filter((id) => !markers[id].extra)
    .find((id) => !(progress[id] ?? false));
  return markersId ? markers[markersId] : null;
});

/*********************************
 * NavigateTo Marker Atoms
 *********************************/

export const navigateToMarkerAtom = atom<IMarker | null>((get) => {
  return get(selectedMarkerAtom) || get(suggestedMarkerAtom);
});

/*********************************
 * Map/List UI State
 *********************************/

const hasStartedTourAtom = atomWithStorage("mdc.tour.hasStartedTour", false);
export const setTourToStartedAtom = atom(null, (_get, set) => {
  set(hasStartedTourAtom, true);
});

export const tourStateAtom = atom<TourStates>((get) => {
  const selectedMarker = get(selectedMarkerAtom);
  const hasStartedTour = get(hasStartedTourAtom);
  const progress = get(getAllMarkerProgressAtom);
  if (!hasStartedTour) return "welcome";
  if (selectedMarker && !!progress[selectedMarker.id]) return "completed";
  if (selectedMarker) return "selected";
  return "suggested";
});

/***************************************
 * Directions (Routing) Query / Atoms
 ***************************************/

function roundToNearestThousand(n: number) {
  return Math.round(n * 10000) / 10000;
}

export const getDirectionCoordsAtom = atom<[number, number][] | null>((get) => {
  const userLocation = get(getSavedUserLocationAtom);
  const marker = get(navigateToMarkerAtom);
  if (userLocation && marker) {
    const [markerLat, markerLng] = marker.point;
    // Rounding the Lat or Lng position to the nearest thousand
    // allows for react-query to have an opportunity to cache the
    // request. Eg. 42.431455893 vs 42.4325
    return [
      // Tuples need to be [lng, lat] not [lat, lng]
      [
        roundToNearestThousand(userLocation.latlng.lng),
        roundToNearestThousand(userLocation.latlng.lat),
      ],
      [roundToNearestThousand(markerLng), roundToNearestThousand(markerLat)],
    ] as [number, number][];
  }
  return null;
});

// TODO: Unclear what the second type argument is for
// Could be for the dispatch eg. const [data, dispatch] = useAtom(directionQueryAtom);
export const directionQueryAtom = atomWithQuery<
  FeatureCollection | { features: [] },
  unknown
>((get) => ({
  queryKey: ["directions", get(getDirectionCoordsAtom)],
  queryFn: async () => {
    const coords = get(getDirectionCoordsAtom);
    const enableDirections = get(getEnableDirectionsAtom);
    if (enableDirections && coords) {
      return fetchRoute(
        coords,
        get(getORSAPIKeyAtom),
        get(getORSAPIEndpointAtom)
      );
    }
    console.warn("Coords is empty. Aborting");
    return { features: [] };
  },
}));

export const refetchDirectionQueryAtom = atom(null, (_get, set) =>
  set(directionQueryAtom, { type: "refetch" })
);

export const loadableDirectionQueryAtom = loadable(directionQueryAtom);

/*********************************
 * Markers Query
 *********************************/

export const markersQueryAtom = atomWithQuery<
  ReturnType<typeof fetchMarkers>,
  unknown
>(() => ({
  queryKey: ["markers"],
  queryFn: fetchMarkers,
}));

/*********************************
 * Details Page Query / Atoms
 *********************************/

const detailsMarkerIdAtom = atom<string | null>(
  isDetailUrl && urlHasId(detailUrlParams.id) ? detailUrlParams.id : null
);
// The marker id should be set before navigation
export const setDetailsMarkerIdAtom = atom(
  null,
  (_get, set, value: string | null) => {
    set(detailsMarkerIdAtom, value);
  }
);
export const lastViewedMarkerIdAtom = atom((get) => get(detailsMarkerIdAtom));

export const detailsQueryAtom = atomWithQuery<
  ReturnType<typeof fetchMarkerDetails>,
  unknown
>((get) => ({
  queryKey: ["details", get(detailsMarkerIdAtom)],
  queryFn: async () => {
    const selectedMarkerId = get(detailsMarkerIdAtom);
    if (selectedMarkerId) {
      return fetchMarkerDetails(selectedMarkerId);
    }
    throw new Error("Selected marker ID does not exist. Aborting.");
  },
}));

/*********************************
 * Bounding Box Json Query
 *********************************/

export const boundingBoxQueryAtom = atomWithQuery<
  ReturnType<typeof fetchBoundingBox>,
  unknown
>(() => ({
  queryKey: ["bounding_box"],
  queryFn: fetchBoundingBox,
}));

export const paddedBoundingBoxAtom = atom<LatLngBounds>((get) => {
  return get(boundingBoxQueryAtom).pad(0.5);
});
