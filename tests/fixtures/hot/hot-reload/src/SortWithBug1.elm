module SortWithBug1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Attributes


type alias Msg =
    ()


type alias Model =
    String -> String -> Order


init : Model
init =
    compare


update : Msg -> Model -> Model
update () model =
    model


view : Model -> Html Msg
view model =
    Html.div [ Html.Attributes.title "hot reload" ]
        ([ "b", "a" ]
            |> List.sortWith model
            |> List.map Html.text
        )


main : Program () Model Msg
main =
    Browser.sandbox
        { init = init
        , view = view
        , update = update
        }
