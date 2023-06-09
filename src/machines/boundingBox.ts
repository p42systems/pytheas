import {
  ActorRef,
  assign,
  createMachine,
  DoneInvokeEvent,
  EventObject,
  sendParent,
  spawn,
} from "xstate";
import { stop } from "xstate/lib/actions";
import { LatLngBounds } from "leaflet";
import {
  checkForGeoLocationAPI,
  checkWithinBounds,
  fetchBoundingBox,
} from "./../services";
import {
  watchLocationFactory,
  WatchLocationEvents,
  SetLocationEvent,
  ErrorEvent,
} from "../watchLocation";
import { UserLocation } from "../types";

type ParentEvent =
  | { type: "UNKNOWN_LOCATION" }
  | { type: "OUT_OF_BOUNDS" }
  | { type: "INSIDE_OF_BOUNDS" }
  | { type: "NO_BOUNDING_BOX" }
  | { type: "NEW_LOCATION"; userLocation: UserLocation }
  | { type: "INITIAL_LOCATION"; userLocation: UserLocation }
  | { type: "SET_HIGH_ACCURACY"; highAccuracy: boolean }
  | { type: "NO_GEO_SUPPORT" };

function createSendParent<TParentEvent extends { type: string }>() {
  return function <TContext, TEvent extends { type: string }>(
    event: Parameters<typeof sendParent<TContext, TEvent, TParentEvent>>[0],
    options?: Parameters<typeof sendParent<TContext, TEvent, TParentEvent>>[1]
  ) {
    return sendParent<TContext, TEvent, TParentEvent>(event, options);
  };
}

type BoundingBoxContext = {
  watchLocationRef: ActorRef<EventObject, WatchLocationEvents> | null;
  enableHighAccuracy: boolean;
  boundingBox: LatLngBounds | null;
  userLocation: UserLocation | null;
};

const customSendParent = createSendParent<ParentEvent>();

type BoundingBoxEvents =
  | SetLocationEvent
  | ErrorEvent
  | { type: "TOGGLE_HIGH_ACCURACY" }
  | { type: "CHECK_BOUNDS" };

export const boundingBoxMachine = createMachine(
  {
    tsTypes: {} as import("./boundingBox.typegen").Typegen0,
    schema: {
      context: {} as BoundingBoxContext,
      events: {} as BoundingBoxEvents,
      services: {} as {
        checkWithinBounds: {
          data: boolean;
        };
        checkForGeoLocationAPI: {
          data: void;
        };
        fetchBoundingBox: {
          data: LatLngBounds;
        };
      },
    },
    id: "BoundingBox",
    initial: "checkingForGeoLocationAPI",
    context: {
      watchLocationRef: null,
      enableHighAccuracy: false,
      boundingBox: null,
      userLocation: null,
    },
    states: {
      checkingForGeoLocationAPI: {
        invoke: {
          src: "checkForGeoLocationAPI",
          id: "checkForGeoLocationAPI",
          onError: [
            {
              description:
                "Browser does not have support for the GeoLocation API",
              target: "noGeoSupport",
            },
          ],
          onDone: [
            {
              description: "The browser has support for the GeoLocation API",
              target: "fetchingBoundingBox",
            },
          ],
        },
        description:
          "Checking if the browser has support for the GeoLocation API",
      },
      fetchingBoundingBox: {
        invoke: {
          src: "fetchBoundingBox",
          id: "fetchBoundingBox",
          onError: [
            {
              target: "noBoundingBox",
            },
          ],
          onDone: [
            {
              actions: [
                assign<BoundingBoxContext, DoneInvokeEvent<LatLngBounds>>({
                  boundingBox: (_, event) => event.data,
                }),
              ],
              target: "running",
            },
          ],
        },
      },
      running: {
        entry: [
          assign((context: BoundingBoxContext) => ({
            watchLocationRef: spawn(
              watchLocationFactory(context.enableHighAccuracy),
              "watchLocation"
            ),
          })),
        ],
        on: {
          TOGGLE_HIGH_ACCURACY: {
            target: "#BoundingBox.restartWatchLocation",
            actions: [
              assign((context: BoundingBoxContext) => ({
                enableHighAccuracy: !context.enableHighAccuracy,
              })),
            ],
          },
        },
        exit: [stop("watchLocation")],
        initial: "init",
        states: {
          init: {
            on: {
              SET_LOCATION: {
                target: "checkingBoundingBox",
                actions: [
                  assign(
                    (
                      _context: BoundingBoxContext,
                      event: SetLocationEvent
                    ) => ({
                      userLocation: event.userLocation,
                    })
                  ),
                  customSendParent(
                    (
                      _context: BoundingBoxContext,
                      event: SetLocationEvent
                    ) => ({
                      type: "INITIAL_LOCATION",
                      userLocation: event.userLocation,
                    })
                  ),
                ],
              },
              ERROR: {
                target: "#BoundingBox.unknownLocation",
                actions: [
                  (_context: BoundingBoxContext, event: ErrorEvent) =>
                    console.error(event.error),
                ],
              },
            },
          },
          outside: {
            entry: [
              customSendParent({
                type: "OUT_OF_BOUNDS",
              }),
            ],
            always: {
              target: "canSendLocation",
            },
          },
          inside: {
            entry: [
              customSendParent({
                type: "INSIDE_OF_BOUNDS",
              }),
            ],
            always: {
              target: "canSendLocation",
            },
          },
          waitToSendNewLocation: {
            on: {
              CHECK_BOUNDS: {
                target: "checkingBoundingBox",
              },
            },
            after: {
              // Only allow the user's location to get set every 5 seconds
              // This prevents state spam which causing the components to
              // trigger a re-render very quickly
              5000: { target: "canSendLocation" },
            },
          },
          canSendLocation: {
            on: {
              CHECK_BOUNDS: {
                target: "checkingBoundingBox",
              },
              SET_LOCATION: {
                target: "waitToSendNewLocation",
                actions: [
                  assign(
                    (
                      _context: BoundingBoxContext,
                      event: SetLocationEvent
                    ) => ({
                      userLocation: event.userLocation,
                    })
                  ),
                  customSendParent(
                    (
                      _context: BoundingBoxContext,
                      event: SetLocationEvent
                    ) => ({
                      type: "NEW_LOCATION",
                      userLocation: event.userLocation,
                    })
                  ),
                ],
              },
            },
          },
          checkingBoundingBox: {
            invoke: {
              src: "checkWithinBounds",
              id: "checkWithinBounds",
              onDone: [
                {
                  target: "inside",
                  cond: (_context, event: DoneInvokeEvent<boolean>) =>
                    event.data,
                },
                {
                  target: "outside",
                },
              ],
              onError: [
                {
                  target: "#BoundingBox.unknownLocation",
                },
              ],
            },
          },
        },
      },
      restartWatchLocation: {
        entry: [
          customSendParent((context: BoundingBoxContext) => ({
            type: "SET_HIGH_ACCURACY",
            highAccuracy: context.enableHighAccuracy,
          })),
        ],
        always: [{ target: "running" }],
      },
      unknownLocation: {
        type: "final",
        entry: customSendParent({ type: "UNKNOWN_LOCATION" }),
      },
      noGeoSupport: {
        type: "final",
        entry: customSendParent({ type: "NO_GEO_SUPPORT" }),
      },
      noBoundingBox: {
        type: "final",
        entry: customSendParent({ type: "NO_BOUNDING_BOX" }),
      },
    },
  },
  {
    services: {
      checkForGeoLocationAPI: checkForGeoLocationAPI,
      fetchBoundingBox: fetchBoundingBox,
      checkWithinBounds: (context: BoundingBoxContext) =>
        checkWithinBounds(context.userLocation, context.boundingBox),
    },
    actions: {},
    guards: {},
  }
);
