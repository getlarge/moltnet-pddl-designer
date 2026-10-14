# Station inspection

Stations and parcels are the only kinds of objects. Trusted code performs the
two steps, inspect-station and process-parcel; there is no agent object.

Inspect-station requires an idle station. It makes the station freshly
inspected and removes its idle state.

Process-parcel requires a freshly inspected station and a ready parcel. Any
such station may process any ready parcel. Processing makes that parcel done,
removes its ready state, consumes the station's fresh inspection, and makes
the station idle again. Every processing operation therefore needs a new
inspection. Done parcels stay done and cannot be processed again. No objects
are created.
