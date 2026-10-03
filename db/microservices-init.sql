/* =====================================================================
   DATABASE PER SERVICE
   One PostgreSQL server (so the DB resources match the monolith version),
   but every service has its own DATABASE and USER. A service's user has
   NO access to another service's database, so cross-service JOINs are
   impossible and all communication must go through an API or an event.

   In production, each service's database usually lives on its own
   server/instance as well.
   ===================================================================== */

CREATE ROLE user_svc         LOGIN PASSWORD 'user_svc';
CREATE ROLE product_svc      LOGIN PASSWORD 'product_svc';
CREATE ROLE order_svc        LOGIN PASSWORD 'order_svc';
CREATE ROLE payment_svc      LOGIN PASSWORD 'payment_svc';
CREATE ROLE notification_svc LOGIN PASSWORD 'notification_svc';

CREATE DATABASE user_db         OWNER user_svc;
CREATE DATABASE product_db      OWNER product_svc;
CREATE DATABASE order_db        OWNER order_svc;
CREATE DATABASE payment_db      OWNER payment_svc;
CREATE DATABASE notification_db OWNER notification_svc;

REVOKE ALL ON DATABASE user_db         FROM PUBLIC;
REVOKE ALL ON DATABASE product_db      FROM PUBLIC;
REVOKE ALL ON DATABASE order_db        FROM PUBLIC;
REVOKE ALL ON DATABASE payment_db      FROM PUBLIC;
REVOKE ALL ON DATABASE notification_db FROM PUBLIC;
