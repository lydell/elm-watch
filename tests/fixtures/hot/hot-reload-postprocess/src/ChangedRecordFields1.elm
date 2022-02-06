module ChangedRecordFields1 exposing (main)

import Browser
import Html exposing (Html)



-- a = { field = " and new text" }


main : Program () () ()
main =
    Browser.element
        { init = always ( (), Cmd.none )
        , update = \() () -> ( (), Cmd.none )
        , subscriptions = always Sub.none
        , view =
            always <|
                Html.text <|
                    "Text"

        -- ++ a.field
        }
