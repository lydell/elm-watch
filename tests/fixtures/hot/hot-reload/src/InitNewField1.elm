module InitNewField1 exposing (main)

import Browser
import Html exposing (Html)


type alias Model =
    { field1 : String

    -- , newField : String
    }


init : () -> ( Model, Cmd () )
init () =
    ( { field1 = "field1"

      -- , newField = " with newField"
      }
    , Cmd.none
    )


view : Model -> Html ()
view model =
    Html.text
        (model.field1
         -- ++ model.newField
        )


main : Program () Model ()
main =
    Browser.element
        { init = init
        , update = \() model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , view = view
        }
