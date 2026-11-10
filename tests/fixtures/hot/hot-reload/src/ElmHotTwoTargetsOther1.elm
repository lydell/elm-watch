module ElmHotTwoTargetsOther1 exposing (main)

import Browser
import Html
import Html.Attributes
import Html.Events


type Msg
    = Increment


main : Program () Int Msg
main =
    Browser.element
        { init = always ( 0, Cmd.none )
        , update = \Increment count -> ( count + 1, Cmd.none )
        , view =
            \count ->
                Html.div [ Html.Attributes.class "other" ]
                    [ Html.text "Other"
                    , Html.button [ Html.Events.onClick Increment ] [ Html.text (String.fromInt count) ]
                    ]
        , subscriptions = always Sub.none
        }
