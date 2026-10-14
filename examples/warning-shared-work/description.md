# Shared ticket queue

Workers and tickets are the only kinds of objects. The two steps are
claim-ticket and finish-ticket.

Any worker may claim any ready ticket. Claiming removes the ready state and
makes the ticket claimed. Claiming does not reserve the worker or give that
worker exclusive rights to the ticket.

Any worker may finish any claimed ticket, including a ticket claimed by another
worker. Finishing makes that ticket done and removes its claimed state. A done
ticket stays done and cannot be claimed again. No objects are created.
