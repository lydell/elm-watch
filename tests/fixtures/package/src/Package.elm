module Package exposing (view)

import Html exposing (Html)
import Package.Internal


view : Html msg
view =
    Html.text Package.Internal.greeting
