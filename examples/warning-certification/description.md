# Permanent station certification

Stations and parcels are the only kinds of objects. Trusted code performs the
two steps, certify-station and process-parcel; there is no agent object.

Certify-station requires an uncertified station. It makes that station
certified and removes its uncertified state. Certification is permanent: it
never expires and processing does not consume or invalidate it.

Process-parcel requires a certified station and a ready parcel. Any certified
station may process any ready parcel. Processing makes the parcel done and
removes its ready state. The station remains certified and may process another
parcel immediately. Done parcels stay done and cannot be processed again. No
objects are created.
