port module DocumentMain exposing (main)

import Browser
import Html
import Html.Attributes as Attr
import Html.Events exposing (onClick)
import Shared


port openModalDialog : () -> Cmd msg


type Msg
    = IncrementClicked
    | DecrementClicked
    | OpenModalDialogClicked


type alias Model =
    { count : Int
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { count = 0
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        IncrementClicked ->
            ( { model | count = model.count + 1 }, Cmd.none )

        DecrementClicked ->
            ( { model | count = model.count - 1 }, Cmd.none )

        OpenModalDialogClicked ->
            ( model, openModalDialog () )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Browser.Document Msg
view model =
    { title = "Awesome counter app"
    , body =
        [ Html.main_ []
            [ Html.button [ onClick DecrementClicked ]
                [ Html.text Shared.minus ]
            , Html.text (" " ++ String.fromInt model.count ++ " ")
            , Html.button [ onClick IncrementClicked ]
                [ Html.text Shared.plus ]
            , Html.hr [] []
            , Html.button [ Attr.attribute "popovertarget" "popover" ]
                [ Html.text "Open popover" ]
            , Html.p [ Attr.attribute "popover" "auto", Attr.id "popover" ]
                [ Html.text "popover – should be covered by the error display" ]
            , Html.button [ onClick OpenModalDialogClicked ]
                [ Html.text "Open modal dialog" ]
            , Html.node "dialog"
                []
                [ Html.text "modal dialog – should be covered by the error display" ]
            , Html.p
                [ Attr.style "position" "fixed"
                , Attr.style "top" "0"
                , Attr.style "right" "0"
                , Attr.style "background" "red"
                , Attr.style "z-index" "2147483647"
                ]
                [ Html.text "position: fixed with maximum z-index – should be covered by the error overlay" ]
            ]
        ]
    }


main : Program () Model Msg
main =
    Browser.document
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }
