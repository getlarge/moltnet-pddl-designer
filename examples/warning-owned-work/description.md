# Ticket processing

Workers and tickets are the only kinds of objects. The two steps are
claim-ticket and finish-ticket.

Any free worker may claim any ready ticket. Claiming removes the ticket's ready
state, records that the ticket is claimed by that worker, and makes that worker
busy instead of free.

Only the worker that claimed a ticket may finish it. Finishing requires that
worker to be busy and the ticket to be claimed by that worker. It makes the
ticket done, removes its claimed state, and makes the worker free again. A done
ticket stays done and cannot be claimed again. No objects are created.
