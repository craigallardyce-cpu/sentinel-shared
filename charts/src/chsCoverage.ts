import type { CoverageBox } from './types.js';

/**
 * Waters that are Canadian and nowhere American: where `chs_enc` is chosen
 * ahead of `noaa_enc`.
 *
 * CHS used to carry one box, 141°W to 52°W and 41°N to 84°N, listed after NOAA,
 * whose own continental box runs to 50°N. Every Canadian harbour south of 50°N
 * (Victoria, Vancouver, the Canadian shore of the Great Lakes, the St Lawrence,
 * the Bay of Fundy, Nova Scotia west of 65°W) therefore got the US chart
 * service, which draws nothing there. So did the coast of British Columbia
 * north of 50°N, which sits inside NOAA's Alaska box.
 *
 * The boxes are a staircase drawn on the Canadian side of the boundary, never
 * across it: a box that took in American water would hand a boat in a US
 * harbour the Canadian chart, which is the same fault the other way round and
 * a regression for most of the fleet. Where a river is the border (Detroit, St
 * Clair, Niagara, the upper St Lawrence, the St Croix) or the towns face each
 * other across a mile of water (Sault Ste Marie, the Thousand Islands) no box
 * is drawn, and those waters stay with NOAA as before. Dixon Entrance north of
 * 54.3°N and the Beaufort Sea west of 137°W are left out because the two
 * countries do not agree where the line is.
 *
 * Checked on 2026-11-16 against the Natural Earth 1:10m country outlines, which
 * split the Great Lakes along the boundary: sampled every 0.01° to 0.1°, no
 * point of any box lies in the United States, and at sea every point is nearer
 * Canadian land than American. The one exception is eight samples at the edge
 * of the Fundy box off Campobello Island, which that dataset draws as American
 * and which is Canadian; the box stops at 66.8°W, east of the island. The
 * ports in `tests/registry.test.ts` pin both sides.
 *
 * Each row is west, south, east, north.
 */
const ROWS: Array<[number, number, number, number]> = [
  // Everything north of 50°N east of 128°W, and everything east of 65°W.
  [-128, 50, -65, 84],
  [-65, 41, -52, 84],
  // British Columbia: the outer coast and Haida Gwaii, then Juan de Fuca Strait
  // north of the mid-channel line, the Gulf Islands, and the mainland from 49°N.
  [-134, 50, -128, 54.3],
  [-131.2, 54.3, -128, 54.5],
  [-134, 48.6, -124.8, 50],
  [-124.8, 48.5, -124.3, 50],
  [-124.3, 48.4, -123.9, 50],
  [-123.9, 48.3, -123.3, 50],
  [-123.3, 48.74, -123.17, 48.88],
  [-123.3, 49.01, -95.2, 50],
  // The Beaufort Sea east of the disputed sector.
  [-137, 68.5, -128, 84],
  // Lake of the Woods north of the Northwest Angle, then east to Lake Superior.
  [-95.2, 49.4, -94.4, 50],
  [-94.4, 49, -89.6, 50],
  // Lake Superior, stepping down its length north of the boundary.
  [-89.6, 48.17, -89, 50],
  [-89, 48.36, -88, 50],
  [-88, 48.22, -87, 50],
  [-87, 47.82, -86, 50],
  [-86, 47.42, -85, 50],
  [-85, 47.01, -84.8, 50],
  [-84.8, 46.75, -84.4, 50],
  // The North Channel and Georgian Bay.
  [-84.4, 46.6, -84.05, 50],
  [-84.05, 46.17, -83.45, 50],
  [-83.45, 45.79, -83, 50],
  [-83, 45.61, -82.55, 50],
  // Lake Huron east of the boundary, which runs a little west of south here.
  [-82.55, 45.4, -82.4, 50],
  [-82.4, 44.9, -82.2, 50],
  [-82.2, 44.1, -82.08, 50],
  [-82.08, 42.11, -81.6, 50],
  // Lake St Clair's east side and the west end of Lake Erie, Pelee Island included.
  [-82.4, 41.9, -82.08, 42.9],
  [-82.75, 41.75, -82.4, 42.42],
  [-82.6, 42.42, -82.4, 42.55],
  [-82.9, 41.9, -82.75, 42.33],
  // Lake Erie.
  [-81.6, 42.31, -81, 50],
  [-81, 42.51, -80, 50],
  [-80, 42.79, -79.2, 50],
  // Lake Ontario as far as Kingston.
  [-79.2, 43.69, -76.9, 50],
  [-76.9, 43.95, -76.6, 50],
  [-76.6, 44.13, -76.45, 50],
  [-76.45, 44.28, -76.2, 50],
  // The Ottawa and the St Lawrence below Cornwall, then the Gulf.
  [-76.2, 45.06, -71.6, 50],
  [-71.6, 46.5, -70.4, 50],
  [-70.4, 47.52, -65, 50],
  // The Bay of Fundy and south-west Nova Scotia.
  [-66.8, 43, -65, 47.52],
  [-66, 41.3, -65, 43],
];

export const CHS_WATERS: CoverageBox[] = ROWS.map(([west, south, east, north]) => ({
  west,
  south,
  east,
  north,
}));

/**
 * The whole area CHS charts some part of. Asked only after every official
 * provider has been asked for its own waters, so that Canadian water the
 * staircase leaves out still gets the Canadian chart when the US one does not
 * claim it.
 */
export const CHS_REACH: CoverageBox[] = [{ west: -141, south: 41, east: -52, north: 84 }];
