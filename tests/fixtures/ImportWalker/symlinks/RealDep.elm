-- Note: Since we’re have `import DepSymlink`, this needs to have
-- `module DepSymlink` rather than `module RealDep`. That’s how
-- `elm make` works at least.
module DepSymlink exposing (a)

import FinalDep

a = FinalDep.a
